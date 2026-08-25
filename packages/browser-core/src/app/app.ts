import { captchaSelectors } from '../captcha/captcha-selectors'
import { findCaptchaTarget, isSameCaptchaTarget, type CaptchaTarget } from '../captcha/captcha-target'
import { TRANSIENT_RETRY_DELAYS_MS } from '../captcha/captcha-solver'
import { isPermanentModelError } from '../model/permanent-model-error'
import { sleep } from '../utils/delay'
import { formatErrorMessage } from '../utils/errors'
import { warn } from '../utils/logger'
import type { AppDependencies } from './app-dependencies'

const STARTUP_SCAN_DELAY_MS = 100
const MUTATION_SCAN_DEBOUNCE_MS = 100
const TRANSIENT_FAILURE_RETRY_AFTER_MS = 30_000
const SOLVER_FAILURE_RETRY_AFTER_MS = 30_000

type PrepareTargetResult = 'prepared' | 'stale' | 'permanent-failure' | 'transient-failure'

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
  private lastCaptchaTarget: CaptchaTarget | null = null
  private failedCaptchaTarget: CaptchaTarget | null = null
  private transientSuppressionAt: number | null = null
  private solverFailureSuppressionAt: number | null = null
  private preparingCaptchaTarget: CaptchaTarget | null = null
  private modelCredentialsRevision = 0
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

  recoverAfterModelCredentialsChanged(): void {
    if (this.destroyed) {
      return
    }
    const currentTarget = findCaptchaTarget()
    const recoveryTarget = [this.failedCaptchaTarget, this.preparingCaptchaTarget].find((target) =>
      isSameCaptchaTarget(target, currentTarget),
    )
    if (!recoveryTarget) {
      return
    }
    this.modelCredentialsRevision += 1
    this.failedCaptchaTarget = null
    this.transientSuppressionAt = null
    this.solverFailureSuppressionAt = null
    if (isSameCaptchaTarget(this.lastCaptchaTarget, currentTarget)) {
      this.lastCaptchaTarget = null
    }
    this.scheduleSolve()
  }

  init(): void {
    this.solveAbortController?.abort()
    if (this.startupTimeoutId !== null) {
      clearTimeout(this.startupTimeoutId)
      this.startupTimeoutId = null
    }
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
      }, STARTUP_SCAN_DELAY_MS)
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
    this.lastCaptchaTarget = null
    this.failedCaptchaTarget = null
    this.transientSuppressionAt = null
    this.solverFailureSuppressionAt = null
    this.preparingCaptchaTarget = null
    this.modelCredentialsRevision += 1
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
      for (const node of record.addedNodes) {
        if (this.isCaptchaNode(node)) {
          return true
        }
      }
      for (const node of record.removedNodes) {
        if (this.isCaptchaNode(node)) {
          return true
        }
      }
    }
    return false
  }

  private isCaptchaNode(node: Node): boolean {
    return node instanceof Element && (node.id === 'riddlemaster' || node.querySelector('#riddlemaster') !== null)
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
      }, MUTATION_SCAN_DEBOUNCE_MS)
    })
    const target = document.body || document.documentElement
    if (target) {
      this.observer.observe(target, { attributes: true, attributeFilter: ['src'], childList: true, subtree: true })
    }
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

  private isTargetCurrent(target: CaptchaTarget, signal?: AbortSignal): boolean {
    return !this.destroyed && signal?.aborted !== true && isSameCaptchaTarget(target, findCaptchaTarget())
  }

  private async prepareTarget(
    target: CaptchaTarget,
    credentialsRevision: number,
    signal?: AbortSignal,
  ): Promise<PrepareTargetResult> {
    this.preparingCaptchaTarget = target
    try {
      for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS_MS.length; attempt += 1) {
        if (!this.isTargetCurrent(target, signal) || credentialsRevision !== this.modelCredentialsRevision) {
          return 'stale'
        }
        try {
          await this.detector.prepare(signal)
          return this.isTargetCurrent(target, signal) && credentialsRevision === this.modelCredentialsRevision
            ? 'prepared'
            : 'stale'
        } catch (error) {
          if (!this.isTargetCurrent(target, signal) || credentialsRevision !== this.modelCredentialsRevision) {
            return 'stale'
          }
          if (isPermanentModelError(error)) {
            warn('启动 ONNX 失败:', formatErrorMessage(error))
            return 'permanent-failure'
          }
          const retryDelay = TRANSIENT_RETRY_DELAYS_MS[attempt]
          if (retryDelay === undefined) {
            warn('启动 ONNX 失败:', formatErrorMessage(error))
            return 'transient-failure'
          }
          await sleep(retryDelay, signal)
        }
      }
      return 'transient-failure'
    } finally {
      if (this.preparingCaptchaTarget === target) {
        this.preparingCaptchaTarget = null
      }
    }
  }

  private async runSolve(): Promise<void> {
    let target: CaptchaTarget | null = null
    const signal = this.solveAbortController?.signal
    const credentialsRevision = this.modelCredentialsRevision
    try {
      target = findCaptchaTarget()
      if (this.destroyed || this.solver.isBusy || !target) {
        return
      }
      if (
        this.transientSuppressionAt !== null &&
        Date.now() - this.transientSuppressionAt >= TRANSIENT_FAILURE_RETRY_AFTER_MS &&
        isSameCaptchaTarget(target, this.lastCaptchaTarget)
      ) {
        // The host outage behind a transient-failure suppression may have
        // healed; allow one fresh cycle instead of skipping until reload.
        this.lastCaptchaTarget = null
        this.failedCaptchaTarget = null
        this.transientSuppressionAt = null
      }
      if (
        this.solverFailureSuppressionAt !== null &&
        Date.now() - this.solverFailureSuppressionAt >= SOLVER_FAILURE_RETRY_AFTER_MS &&
        isSameCaptchaTarget(target, this.lastCaptchaTarget)
      ) {
        this.lastCaptchaTarget = null
        this.failedCaptchaTarget = null
        this.solverFailureSuppressionAt = null
      }
      if (isSameCaptchaTarget(target, this.lastCaptchaTarget)) {
        return
      }
      this.solverFailureSuppressionAt = null
      const prepareResult = await this.prepareTarget(target, credentialsRevision, signal)
      if (prepareResult !== 'prepared') {
        if (
          (prepareResult === 'permanent-failure' || prepareResult === 'transient-failure') &&
          this.isTargetCurrent(target, signal)
        ) {
          this.failedCaptchaTarget = target
          this.lastCaptchaTarget = target
          this.transientSuppressionAt = prepareResult === 'transient-failure' ? Date.now() : null
        }
        return
      }
      this.failedCaptchaTarget = null
      this.transientSuppressionAt = null
      this.solverFailureSuppressionAt = null
      const result = await this.solver.trigger(target)
      if (result.handled && this.isTargetCurrent(target, signal)) {
        this.lastCaptchaTarget = target
      } else if (!result.handled && result.captchaKey === target.captchaKey && this.isTargetCurrent(target, signal)) {
        this.lastCaptchaTarget = target
        this.failedCaptchaTarget = target
        this.solverFailureSuppressionAt = Date.now()
      }
    } catch (error) {
      if (target && this.isTargetCurrent(target, signal)) {
        this.lastCaptchaTarget = target
        this.failedCaptchaTarget = target
        this.transientSuppressionAt = null
        this.solverFailureSuppressionAt = Date.now()
        warn('处理验证码失败:', formatErrorMessage(error))
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
