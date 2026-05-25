import { captchaSelectors } from '../captcha/captcha-selectors'
import { findCaptchaTarget } from '../captcha/captcha-target'
import { registerModelSettingsMenu } from '../model/model-settings'
import { registerPanelSettingsMenu } from '../status-panel/panel-settings'
import { formatErrorMessage } from '../utils/errors'
import { log, warn } from '../utils/logger'
import { createAppDependencies, type AppDependencies } from './app-dependencies'

export class App {
  private readonly panel: AppDependencies['panel']
  private readonly modelCache: AppDependencies['modelCache']
  private readonly detector: AppDependencies['detector']
  private readonly solver: AppDependencies['solver']
  private observer: MutationObserver | null = null
  private scheduledScan = false
  private lastCaptchaKey: string | null = null
  private destroyed = false
  private modelSettingsMenuRegistered = false

  constructor(dependencies: AppDependencies = createAppDependencies()) {
    this.panel = dependencies.panel
    this.modelCache = dependencies.modelCache
    this.detector = dependencies.detector
    this.solver = dependencies.solver
  }

  init(): void {
    this.destroyed = false
    this.panel.create()
    if (!this.modelSettingsMenuRegistered) {
      registerModelSettingsMenu(() => this.verifyConfiguredModelKey())
      registerPanelSettingsMenu()
      this.modelSettingsMenuRegistered = true
    }
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
    this.detector.destroy()
    this.modelCache.close()
    this.panel.destroy()
  }

  private async verifyConfiguredModelKey(): Promise<void> {
    const modelBuffer = await this.modelCache.download(undefined, true)
    await this.modelCache.putCached(modelBuffer, true)
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

  private getCaptchaKey(): string | null {
    return findCaptchaTarget()?.captchaKey ?? null
  }

  private scheduleSolve(): void {
    if (this.destroyed || this.scheduledScan || this.solver.isBusy) {
      return
    }
    this.scheduledScan = true
    queueMicrotask(() => {
      const captchaKey = this.getCaptchaKey()
      if (this.destroyed || this.solver.isBusy || !captchaKey || captchaKey === this.lastCaptchaKey) {
        this.scheduledScan = false
        return
      }
      log('检测到验证码')
      this.detector
        .prepare()
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
