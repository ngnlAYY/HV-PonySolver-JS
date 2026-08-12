import { captchaSelectors } from '../captcha/captcha-selectors'
import { findCaptchaTarget } from '../captcha/captcha-target'
import { formatErrorMessage } from '../utils/errors'
import { warn } from '../utils/logger'
import type { AppDependencies } from './app-dependencies'

export class App {
  private readonly panel: AppDependencies['panel']
  private readonly detector: AppDependencies['detector']
  private readonly solver: AppDependencies['solver']
  private readonly registerSettings: AppDependencies['registerSettings']
  private readonly dispose: AppDependencies['dispose']
  private observer: MutationObserver | null = null
  private observerTimeoutId: ReturnType<typeof setTimeout> | null = null
  private startupTimeoutId: ReturnType<typeof setTimeout> | null = null
  private scheduledScan = false
  private pendingScan = false
  private lastCaptchaKey: string | null = null
  private destroyed = false
  private settingsMenuRegistered = false
  private solveAbortController: AbortController | null = null

  constructor(dependencies: AppDependencies) {
    this.panel = dependencies.panel
    this.detector = dependencies.detector
    this.solver = dependencies.solver
    this.registerSettings = dependencies.registerSettings
    this.dispose = dependencies.dispose
  }

  getAbortSignal(): AbortSignal | undefined {
    return this.solveAbortController?.signal
  }

  init(): void {
    this.destroyed = false
    this.solveAbortController = new AbortController()
    this.panel.create()
    if (!this.settingsMenuRegistered) {
      this.registerSettings?.()
      this.settingsMenuRegistered = true
    }
    if (document.querySelector(captchaSelectors.master)) {
      this.startupTimeoutId = setTimeout(() => {
        this.startupTimeoutId = null
        this.scheduleSolve()
      }, 100)
    }
    this.observe()
  }

  destroy(): void {
    this.destroyed = true
    this.solveAbortController?.abort()
    this.solveAbortController = null
    this.observer?.disconnect()
    this.observer = null
    if (this.observerTimeoutId !== null) {
      clearTimeout(this.observerTimeoutId)
      this.observerTimeoutId = null
    }
    if (this.startupTimeoutId !== null) {
      clearTimeout(this.startupTimeoutId)
      this.startupTimeoutId = null
    }
    this.scheduledScan = false
    this.pendingScan = false
    this.lastCaptchaKey = null
    this.detector.destroy()
    this.dispose?.()
    this.panel.destroy()
  }

  private isCaptchaRelatedMutation(records: MutationRecord[]): boolean {
    const captchaMaster = document.getElementById('riddlemaster')
    for (const record of records) {
      const target = record.target
      if (captchaMaster && (target === captchaMaster || captchaMaster.contains(target as Node))) {
        return true
      }
      for (const node of [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)]) {
        if (!(node instanceof Element)) {
          continue
        }
        if (node.id === 'riddlemaster' || node.querySelector('#riddlemaster') !== null) {
          return true
        }
      }
    }
    return false
  }

  private observe(): void {
    if (this.observer) {
      return
    }
    this.observer = new MutationObserver((records) => {
      if (!this.isCaptchaRelatedMutation(records) || this.observerTimeoutId !== null) {
        return
      }
      this.observerTimeoutId = setTimeout(() => {
        this.observerTimeoutId = null
        this.scheduleSolve()
      }, 100)
    })
    const target = document.body || document.documentElement
    if (target) {
      this.observer.observe(target, { attributes: true, attributeFilter: ['src'], childList: true, subtree: true })
    }
  }

  private getCaptchaKey(): string | null {
    return findCaptchaTarget()?.captchaKey ?? null
  }

  private scheduleSolve(): void {
    if (this.destroyed) {
      return
    }
    if (this.scheduledScan || this.solver.isBusy) {
      this.pendingScan = true
      return
    }
    this.scheduledScan = true
    queueMicrotask(() => {
      void this.runSolve()
    })
  }

  private async runSolve(): Promise<void> {
    try {
      const captchaKey = this.getCaptchaKey()
      if (this.destroyed || this.solver.isBusy || !captchaKey || captchaKey === this.lastCaptchaKey) {
        return
      }
      await this.detector.prepare()
      if (this.destroyed) {
        return
      }
      const result = await this.solver.trigger()
      if (result.handled && result.captchaKey && !this.destroyed) {
        this.lastCaptchaKey = result.captchaKey
      }
    } catch (error) {
      if (!this.destroyed) {
        warn('启动 ONNX 失败:', formatErrorMessage(error))
      }
    } finally {
      this.scheduledScan = false
      if (this.pendingScan && !this.destroyed) {
        this.pendingScan = false
        this.scheduleSolve()
      }
    }
  }
}
