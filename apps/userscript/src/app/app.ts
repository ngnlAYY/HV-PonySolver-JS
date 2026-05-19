import { OnnxWorkerClient } from '../inference/onnx-worker-client'
import { AnswerSubmitter } from '../captcha/answer-submitter'
import { CachedImageLoader } from '../captcha/captcha-image-loader'
import { CaptchaSolver } from '../captcha/captcha-solver'
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
  private readonly detector = new OnnxWorkerClient(this.modelCache, this.panel)
  private readonly imageLoader = new CachedImageLoader()
  private readonly answerSubmitter = new AnswerSubmitter()
  private readonly solver = new CaptchaSolver(this.panel, this.detector, this.imageLoader, this.answerSubmitter)
  private observer: MutationObserver | null = null
  private scheduledScan = false
  private animationFrameId: number | null = null
  private destroyed = false

  init(): void {
    this.destroyed = false
    this.panel.create()
    this.detector.prepare()
      .then(() => log('本地 ONNX 已就绪'))
      .catch((error) => warn('启动预加载失败:', formatErrorMessage(error)))
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
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId)
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
    this.observer = new MutationObserver((mutations) => {
      if (this.solver.isBusy || this.scheduledScan) {
        return
      }
      for (const mutation of mutations) {
        for (let i = 0; i < mutation.addedNodes.length; i += 1) {
          const node = mutation.addedNodes.item(i)
          if (node && this.containsCaptchaNode(node)) {
            this.scheduleSolve()
            return
          }
        }
      }
    })
    const target = document.body || document.documentElement
    if (target) {
      this.observer.observe(target, { childList: true, subtree: true })
    }
  }

  private scheduleSolve(): void {
    if (this.destroyed || this.scheduledScan || this.solver.isBusy) {
      return
    }
    this.scheduledScan = true
    this.animationFrameId = requestAnimationFrame(() => {
      this.animationFrameId = null
      this.scheduledScan = false
      if (this.destroyed || this.solver.isBusy || !document.querySelector(captchaSelectors.master)) {
        return
      }
      log('检测到验证码')
      this.solver.trigger()
    })
  }

  private containsCaptchaNode(node: Node): boolean {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return false
    }
    const element = node as Element
    return element.id === 'riddlemaster'
      || element.matches?.(captchaSelectors.form)
      || element.matches?.(captchaSelectors.image)
      || Boolean(element.querySelector?.(`${captchaSelectors.master}, ${captchaSelectors.form}, ${captchaSelectors.image}`))
  }
}
