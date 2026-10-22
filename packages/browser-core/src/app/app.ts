import { captchaSelectors } from '../captcha/captcha-selectors'
import { findCaptchaTarget, isSameCaptchaTarget, type CaptchaTarget } from '../captcha/captcha-target'
import { TRANSIENT_RETRY_DELAYS_MS } from '../captcha/captcha-solver'
import { isPermanentModelError } from '../model/permanent-model-error'
import { raceAbort } from '../utils/abort-race'
import { sleep } from '../utils/delay'
import { formatErrorMessage } from '../utils/errors'
import { warn } from '../utils/logger'
import type { AppDependencies } from './app-dependencies'

const STARTUP_SCAN_DELAY_MS = 100
const MUTATION_SCAN_DEBOUNCE_MS = 100
const TRANSIENT_FAILURE_RETRY_AFTER_MS = 30_000
const SOLVER_FAILURE_RETRY_AFTER_MS = 30_000

type PrepareTargetResult = 'prepared' | 'stale' | 'permanent-failure' | 'transient-failure'
type ActiveSolve = Readonly<{ target: CaptchaTarget; controller: AbortController }>

export class App {
  private readonly panel: AppDependencies['panel']
  private readonly detector: AppDependencies['detector']
  private readonly solver: AppDependencies['solver']
  private readonly registerSettings: AppDependencies['registerSettings']
  private readonly dispose: AppDependencies['dispose']
  private observer: MutationObserver | null = null
  private observerTimeoutId: ReturnType<typeof setTimeout> | null = null
  private observerScanDeadline = 0
  private startupTimeoutId: ReturnType<typeof setTimeout> | null = null
  private scheduledScan = false
  private pendingScan = false
  private lastCaptchaTarget: CaptchaTarget | null = null
  private failedCaptchaTarget: CaptchaTarget | null = null
  private transientSuppressionAt: number | null = null
  private solverFailureSuppressionAt: number | null = null
  private preparingCaptchaTarget: CaptchaTarget | null = null
  private activeSolve: ActiveSolve | null = null
  private modelCredentialsRevision = 0
  private destroyed = false
  private settingsMenuRegistered = false
  private solveAbortController: AbortController | null = null
  private readonly onCaptchaImageSettled = (event: Event): void => {
    const image = event.target
    if (
      !this.destroyed &&
      image instanceof HTMLImageElement &&
      image.closest(captchaSelectors.master) &&
      image.parentElement?.closest('[id="riddleimage"]')
    ) {
      this.cancelStaleSolve()
      this.scheduleSolve()
    }
  }

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
    const activeSolve = this.scheduledScan || this.preparingCaptchaTarget !== null || this.solver.isBusy
    if (!activeSolve && !recoveryTarget) {
      return
    }
    this.modelCredentialsRevision += 1
    if (activeSolve) {
      // Abort stale detector/solver work, then expose a fresh signal for the recovery scan.
      this.solveAbortController?.abort()
      this.solveAbortController = new AbortController()
    }
    if (recoveryTarget) {
      this.failedCaptchaTarget = null
      this.transientSuppressionAt = null
      this.solverFailureSuppressionAt = null
      if (isSameCaptchaTarget(this.lastCaptchaTarget, currentTarget)) {
        this.lastCaptchaTarget = null
      }
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
    document.removeEventListener('load', this.onCaptchaImageSettled, true)
    document.removeEventListener('error', this.onCaptchaImageSettled, true)
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
    this.activeSolve = null
    this.modelCredentialsRevision += 1
    this.detector.destroy()
    this.dispose?.()
    this.panel.destroy()
  }

  private isCaptchaRelatedMutation(records: MutationRecord[]): boolean {
    // 当前选择器可能已被移除；旧活动目标仍须触发即时取消复核。
    const captchaMasters = [document.getElementById('riddlemaster'), this.activeSolve?.target.master]
    for (const record of records) {
      const target = record.target
      if (
        captchaMasters.some(
          (captchaMaster) =>
            captchaMaster &&
            (target === captchaMaster ||
              captchaMaster.contains(target) ||
              // 外层 fieldset 的 disabled、首个 legend 顺序同样影响控件有效禁用状态。
              (target instanceof HTMLFieldSetElement &&
                target.contains(captchaMaster) &&
                (record.type === 'childList' || record.attributeName === 'disabled'))),
        )
      ) {
        return true
      }
      for (let index = 0; index < record.addedNodes.length; index += 1) {
        const node = record.addedNodes.item(index)
        if (node && this.isCaptchaNode(node)) {
          return true
        }
      }
      for (let index = 0; index < record.removedNodes.length; index += 1) {
        const node = record.removedNodes.item(index)
        if (node && this.isCaptchaNode(node)) {
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
    // load 不冒泡；捕获监听覆盖 srcset/picture 完成选源但不再产生 mutation 的情况。
    document.addEventListener('load', this.onCaptchaImageSettled, true)
    document.addEventListener('error', this.onCaptchaImageSettled, true)
    this.observer = new MutationObserver((records) => {
      if (this.destroyed || !this.isCaptchaRelatedMutation(records)) {
        return
      }
      // 取消不等待扫描防抖；旧初始化不能挡住新目标，也不能在目标短暂离开后继续提交。
      this.cancelStaleSolve()
      const now = performance.now()
      if (this.observerTimeoutId === null) {
        this.observerScanDeadline = now + MUTATION_SCAN_DEBOUNCE_MS
      } else {
        // JPX 等脚本可能批量清除页面定时器。每次相关变更重挂扫描，
        // 但不延长原截止时间，避免持续 mutation 让新目标一直等不到扫描。
        clearTimeout(this.observerTimeoutId)
      }
      this.observerTimeoutId = setTimeout(
        () => {
          this.observerTimeoutId = null
          this.scheduleSolve()
        },
        Math.max(0, this.observerScanDeadline - now),
      )
    })
    // 局部切页可替换整个 body；观察稳定的父节点才能继续发现新验证码。
    const target = document.documentElement
    if (target) {
      this.observer.observe(target, {
        attributes: true,
        attributeFilter: ['id', 'name', 'action', 'formaction', 'type', 'disabled', 'src', 'srcset', 'sizes', 'media'],
        childList: true,
        subtree: true,
      })
    }
  }

  private cancelStaleSolve(): void {
    const active = this.activeSolve
    if (!active || active.controller.signal.aborted || isSameCaptchaTarget(active.target, findCaptchaTarget())) {
      return
    }
    active.controller.abort()
    if (this.solveAbortController === active.controller) {
      this.solveAbortController = new AbortController()
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

  private currentTargetSnapshot(target: CaptchaTarget, signal?: AbortSignal): CaptchaTarget | null {
    if (this.destroyed || signal?.aborted === true) {
      return null
    }
    const currentTarget = findCaptchaTarget()
    return isSameCaptchaTarget(target, currentTarget) ? currentTarget : null
  }

  private isTargetCurrent(target: CaptchaTarget, signal?: AbortSignal): boolean {
    return this.currentTargetSnapshot(target, signal) !== null
  }

  private recoverFailedTargetAfterSubmitEnabled(target: CaptchaTarget): void {
    if (
      this.solverFailureSuppressionAt === null ||
      !this.failedCaptchaTarget?.controls.submitDisabled ||
      target.controls.submitDisabled ||
      !isSameCaptchaTarget(this.failedCaptchaTarget, target)
    ) {
      return
    }
    this.failedCaptchaTarget = null
    this.lastCaptchaTarget = null
    this.solverFailureSuppressionAt = null
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
          await raceAbort(this.detector.prepare(signal), signal)
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
    let activeSolve: ActiveSolve | null = null
    const controller = this.solveAbortController
    const signal = controller?.signal
    const credentialsRevision = this.modelCredentialsRevision
    try {
      target = findCaptchaTarget()
      if (this.destroyed || this.solver.isBusy || !target || !controller) {
        return
      }
      this.recoverFailedTargetAfterSubmitEnabled(target)
      if (
        this.transientSuppressionAt !== null &&
        performance.now() - this.transientSuppressionAt >= TRANSIENT_FAILURE_RETRY_AFTER_MS &&
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
        performance.now() - this.solverFailureSuppressionAt >= SOLVER_FAILURE_RETRY_AFTER_MS &&
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
      activeSolve = { target, controller }
      this.activeSolve = activeSolve
      const startedAt = performance.now()
      const answerSelection = this.solver.captureAnswerSelection?.(target)
      const prepareResult = await this.prepareTarget(target, credentialsRevision, signal)
      if (prepareResult !== 'prepared') {
        const failedTarget =
          prepareResult === 'permanent-failure' || prepareResult === 'transient-failure'
            ? this.currentTargetSnapshot(target, signal)
            : null
        if (failedTarget) {
          this.failedCaptchaTarget = failedTarget
          this.lastCaptchaTarget = failedTarget
          this.transientSuppressionAt = prepareResult === 'transient-failure' ? performance.now() : null
        }
        return
      }
      this.failedCaptchaTarget = null
      this.transientSuppressionAt = null
      this.solverFailureSuppressionAt = null
      const result = await this.solver.trigger(target, startedAt, signal, answerSelection)
      const currentTarget = this.currentTargetSnapshot(target, signal)
      if (result.handled && currentTarget) {
        this.lastCaptchaTarget = currentTarget
      } else if (result.failure !== null && result.captchaKey === target.captchaKey && currentTarget) {
        this.lastCaptchaTarget = currentTarget
        this.failedCaptchaTarget = currentTarget
        this.solverFailureSuppressionAt = result.failure === 'transient' ? performance.now() : null
      }
    } catch (error) {
      const failedTarget = target ? this.currentTargetSnapshot(target, signal) : null
      if (failedTarget) {
        this.lastCaptchaTarget = failedTarget
        this.failedCaptchaTarget = failedTarget
        this.transientSuppressionAt = null
        this.solverFailureSuppressionAt = performance.now()
        warn('处理验证码失败:', formatErrorMessage(error))
      }
    } finally {
      if (this.activeSolve === activeSolve) {
        // pushState/replaceState 不产生 mutation；旧轮次结算后接手当前有效目标，
        // 但不为缺失目标排队，避免无效页面上的微任务自旋。
        this.cancelStaleSolve()
        if (!this.destroyed && activeSolve) {
          const currentTarget = findCaptchaTarget()
          if (currentTarget && !isSameCaptchaTarget(activeSolve.target, currentTarget)) {
            this.pendingScan = true
          }
        }
        this.activeSolve = null
      }
      this.scheduledScan = false
      if (this.pendingScan && !this.destroyed) {
        this.pendingScan = false
        this.scheduleSolve()
      }
    }
  }
}
