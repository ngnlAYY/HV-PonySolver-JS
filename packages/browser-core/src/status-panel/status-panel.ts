import type { AnswerCode } from '@hv-pony-solver/shared/answer'
import type { SettingsStorage } from '../platform/storage'
import type { HistoryStore } from '../persistence/answer-history-store'
import type { HistoryRecord, World } from '../persistence/answer-history-types'
import { formatErrorMessage } from '../utils/errors'
import type { PanelStatus, StatusPanel as StatusPanelContract } from './status-panel-types'
import {
  getPanelHistoryLimit,
  getPanelHistoryLimitSync,
  getPanelPosition,
  getPanelPositionSync,
  isPanelCompactMode,
  isPanelCompactModeSync,
} from './panel-settings'
import { formatAnswers, renderStatusPanelInto } from './status-panel-renderer'

function getWorld(): World {
  return location.pathname.includes('/isekai/') ? 'isekai' : 'main'
}

export class StatusPanel implements StatusPanelContract {
  private el: HTMLDivElement | null = null
  private readonly world: World = getWorld()
  private compactMode = false
  private records: HistoryRecord[] = []
  private historyLimit: number
  private renderQueued = false
  private lastRenderKey = ''
  private persistenceError: string | null = null
  private lifecycleGeneration = 0
  private historyMutationGeneration = 0
  private status: PanelStatus = {
    model: '未开始',
    session: '未开始',
    inference: '空闲',
  }

  constructor(
    private readonly history: HistoryStore,
    private readonly settingsStorage: SettingsStorage,
  ) {
    this.historyLimit = getPanelHistoryLimitSync(settingsStorage)
  }

  create(): void {
    if (this.el) {
      return
    }
    this.lifecycleGeneration += 1
    this.persistenceError = null
    this.records = this.history.get(this.world)
    this.compactMode = isPanelCompactModeSync(this.settingsStorage)
    this.el = document.createElement('div')
    this.el.className = 'ponyLog'
    const syncPosition = getPanelPositionSync(this.settingsStorage)
    this.el.style.cssText = `position:absolute;top:${syncPosition.top}px;left:${syncPosition.left}px;font-size:12px;text-align:left`
    getPanelPosition(this.settingsStorage).then((position) => {
      if (this.el && (position.top !== syncPosition.top || position.left !== syncPosition.left)) {
        this.el.style.top = `${position.top}px`
        this.el.style.left = `${position.left}px`
      }
    })
    isPanelCompactMode(this.settingsStorage).then((compactMode) => {
      if (this.el && compactMode !== this.compactMode) {
        this.compactMode = compactMode
        this.scheduleRender()
      }
    })
    getPanelHistoryLimit(this.settingsStorage).then((historyLimit) => {
      if (this.el && historyLimit !== this.historyLimit) {
        this.historyLimit = historyLimit
        this.scheduleRender()
      }
    })
    document.body.appendChild(this.el)
    this.render()
  }

  setStatus(changes: Partial<PanelStatus>): void {
    this.status = { ...this.status, ...changes }
    this.scheduleRender()
  }

  setSessionReady(elapsed: number): void {
    this.setStatus({ session: `已就绪 ${Number(elapsed) || 0}ms` })
  }

  addSuccess(ponies: AnswerCode[], confidences: Partial<Record<AnswerCode, number>>, elapsed: number): void {
    this.addHistoryRecord({
      type: 'success',
      answers: formatAnswers(ponies, confidences),
      elapsed,
    })
  }

  addManualResult(ponies: AnswerCode[], confidences: Partial<Record<AnswerCode, number>>, elapsed: number): void {
    this.addHistoryRecord({
      type: 'manual',
      answers: formatAnswers(ponies, confidences),
      elapsed,
    })
  }

  addRandomFailure(pony: AnswerCode, elapsed: number): void {
    this.addHistoryRecord({
      type: 'random',
      answers: pony,
      elapsed,
      message: `识别失败，随机选择 ${pony}`,
    })
  }

  addError(message: string, elapsed = 0): void {
    this.addHistoryRecord({
      type: 'error',
      elapsed,
      message,
    })
  }

  destroy(): void {
    this.lifecycleGeneration += 1
    this.renderQueued = false
    this.lastRenderKey = ''
    this.el?.remove()
    this.el = null
  }

  private addHistoryRecord(record: HistoryRecord): void {
    const mutationGeneration = ++this.historyMutationGeneration
    const lifecycleGeneration = this.lifecycleGeneration
    const mutation = this.history.add(this.world, record)
    this.records = mutation.records
    this.persistenceError = null
    this.scheduleRender()

    void mutation.persisted.then(
      (records) => {
        if (!this.el || lifecycleGeneration !== this.lifecycleGeneration) {
          return
        }
        this.records = records
        if (mutationGeneration === this.historyMutationGeneration) {
          this.persistenceError = null
        }
        this.scheduleRender()
      },
      (error: unknown) => {
        if (!this.el || lifecycleGeneration !== this.lifecycleGeneration) {
          return
        }
        this.records = this.history.get(this.world)
        this.persistenceError = `历史记录保存失败：${formatErrorMessage(error)}`
        this.scheduleRender()
      },
    )
  }

  private scheduleRender(): void {
    if (!this.el || this.renderQueued) {
      return
    }
    this.renderQueued = true
    queueMicrotask(() => this.flushRender())
  }

  private flushRender(): void {
    this.renderQueued = false
    this.render()
  }

  private render(): void {
    if (!this.el) {
      return
    }
    const renderKey = JSON.stringify([
      this.world,
      this.status,
      this.records,
      this.compactMode,
      this.historyLimit,
      this.persistenceError,
    ])
    if (renderKey === this.lastRenderKey) {
      return
    }
    this.lastRenderKey = renderKey
    renderStatusPanelInto(
      this.el,
      this.world,
      this.status,
      this.records,
      this.compactMode,
      this.historyLimit,
      this.persistenceError,
    )
  }
}
