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

  init(): void {
    this.panel.create()
    this.detector.prepare()
      .then(() => log('本地 ONNX 已就绪'))
      .catch((error) => warn('启动预加载失败:', formatErrorMessage(error)))
    if (document.querySelector(captchaSelectors.master)) {
      log('检测到验证码')
      setTimeout(() => this.solver.trigger(), 100)
    }
    this.observe()
  }

  destroy(): void {
    this.observer?.disconnect()
    this.observer = null
    this.detector.destroy()
    this.panel.destroy()
  }

  private observe(): void {
    if (this.observer) {
      return
    }
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (this.containsCaptchaNode(node)) {
            log('检测到验证码')
            this.solver.trigger()
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
