import { OnnxWorkerClient } from '../inference/onnx-worker-client'
import { getBundledOnnxRuntimeSource } from '../inference/onnx-runtime-source'
import { AnswerSubmitter } from '../captcha/answer-submitter'
import { CachedImageLoader } from '../captcha/captcha-image-loader'
import { CaptchaSolver } from '../captcha/captcha-solver'
import { findCaptchaTarget } from '../captcha/captcha-target'
import { captchaSelectors } from '../captcha/captcha-selectors'
import { HistoryStore } from '../persistence/answer-history-store'
import { ModelCache } from '../model/model-cache'
import { StatusPanel } from '../status-panel/status-panel'
import { formatErrorMessage } from '../utils/errors'
import { log, warn } from '../utils/logger'

export class App {
  private readonly history = new HistoryStore()
  private readonly panel = new StatusPanel(this.history)
  private readonly modelCache = new ModelCache(this.panel)
  private readonly bundledRuntimeSource = getBundledOnnxRuntimeSource()
  private readonly detector = new OnnxWorkerClient(
    this.modelCache,
    this.panel,
    this.bundledRuntimeSource ? { bundledRuntimeSource: this.bundledRuntimeSource } : {},
  )
  private readonly imageLoader = new CachedImageLoader()
  private readonly answerSubmitter = new AnswerSubmitter()
  private readonly solver = new CaptchaSolver(this.panel, this.detector, this.imageLoader, this.answerSubmitter)
  private observer: MutationObserver | null = null
  private scheduledScan = false
  private animationFrameId: number | null = null
  private lastCaptchaKey: string | null = null
  private destroyed = false

  init(): void {
    this.destroyed = false
    this.panel.create()
    if (document.querySelector(captchaSelectors.master)) {
      setTimeout(() => this.scheduleSolve(), 100)
    }
    this.observe()
  }

  destroy(): void {
    this.destroyed = true
    this.observer?.disconnect()
    this.observer = null
    this.scheduledScan = false
    this.lastCaptchaKey = null
    if (this.animationFrameId !== null) {
      this.cancelFrame(this.animationFrameId)
      this.animationFrameId = null
    }
    this.detector.destroy()
    this.modelCache.close()
    this.panel.destroy()
  }

  private observe(): void {
    if (this.observer) {
      return
    }
    this.observer = new MutationObserver(() => {
      this.scheduleSolve()
    })
    const target = document.body || document.documentElement
    if (target) {
      this.observer.observe(target, { childList: true, subtree: true })
    }
  }

  private requestFrame(callback: FrameRequestCallback): number {
    const requestAnimationFrame = globalThis.requestAnimationFrame ?? ((handler: FrameRequestCallback): number => globalThis.setTimeout(() => handler(Date.now()), 0))
    return requestAnimationFrame(callback)
  }

  private cancelFrame(id: number): void {
    const cancelAnimationFrame = globalThis.cancelAnimationFrame ?? globalThis.clearTimeout
    cancelAnimationFrame(id)
  }

  private getCaptchaKey(): string | null {
    return findCaptchaTarget()?.captchaKey ?? null
  }

  private scheduleSolve(): void {
    if (this.destroyed || this.scheduledScan || this.solver.isBusy) {
      return
    }
    this.scheduledScan = true
    this.animationFrameId = this.requestFrame(() => {
      this.animationFrameId = null
      const captchaKey = this.getCaptchaKey()
      if (this.destroyed || this.solver.isBusy || !captchaKey || captchaKey === this.lastCaptchaKey) {
        this.scheduledScan = false
        return
      }
      log('检测到验证码')
      this.detector.prepare()
        .then(() => {
          this.scheduledScan = false
          if (!this.destroyed) {
            return this.solver.trigger()
          }
          return { solved: false, captchaKey: null }
        })
        .then((result) => {
          if (result.solved && result.captchaKey && !this.destroyed) {
            this.lastCaptchaKey = result.captchaKey
          }
        })
        .catch((error) => {
          this.scheduledScan = false
          if (!this.destroyed) {
            warn('启动 ONNX 失败:', formatErrorMessage(error))
          }
        })
    })
  }

}
