import type { AnswerCode } from '@hv-pony-solver/shared'
import type { HistoryStore } from '../persistence/answer-history-store'
import type { HistoryRecord, World } from '../persistence/answer-history-types'
import type { PanelStatus, StatusPanel as StatusPanelContract } from './status-panel-types'
import {
  getPanelHistoryLimit,
  getPanelHistoryLimitSync,
  getPanelPosition,
  getPanelPositionSync,
  isPanelCompactMode,
  isPanelCompactModeSync,
} from './panel-settings'
import { formatAnswers, renderStatusPanel } from './status-panel-renderer'

function getWorld(): World {
  return location.pathname.includes('/isekai/') ? 'isekai' : 'main'
}

export class StatusPanel implements StatusPanelContract {
  private el: HTMLDivElement | null = null
  private readonly world: World = getWorld()
  private compactMode = false
  private records: HistoryRecord[] = []
  private historyLimit = getPanelHistoryLimitSync()
  private renderQueued = false
  private lastHtml = ''
  private status: PanelStatus = {
    model: '未开始',
    session: '未开始',
    inference: '空闲',
  }

  constructor(private readonly history: HistoryStore) {}

  create(): void {
    if (this.el) {
      return
    }
    this.records = this.history.get(this.world)
    this.compactMode = isPanelCompactModeSync()
    this.el = document.createElement('div')
    this.el.className = 'ponyLog'
    const syncPosition = getPanelPositionSync()
    this.el.style.cssText = `position:absolute;top:${syncPosition.top}px;left:${syncPosition.left}px;font-size:12px;text-align:left`
    getPanelPosition().then((position) => {
      if (this.el && (position.top !== syncPosition.top || position.left !== syncPosition.left)) {
        this.el.style.top = `${position.top}px`
        this.el.style.left = `${position.left}px`
      }
    })
    isPanelCompactMode().then((compactMode) => {
      if (this.el && compactMode !== this.compactMode) {
        this.compactMode = compactMode
        this.scheduleRender()
      }
    })
    getPanelHistoryLimit().then((historyLimit) => {
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
    this.records = this.history.add(this.world, {
      type: 'success',
      answers: formatAnswers(ponies, confidences),
      elapsed,
    })
    this.scheduleRender()
  }

  addManualResult(ponies: AnswerCode[], confidences: Partial<Record<AnswerCode, number>>, elapsed: number): void {
    this.records = this.history.add(this.world, {
      type: 'manual',
      answers: formatAnswers(ponies, confidences),
      elapsed,
    })
    this.scheduleRender()
  }

  addRandomFailure(pony: AnswerCode, elapsed: number): void {
    this.records = this.history.add(this.world, {
      type: 'random',
      answers: pony,
      elapsed,
      message: `识别失败，随机选择 ${pony}`,
    })
    this.scheduleRender()
  }

  addError(message: string, elapsed = 0): void {
    this.records = this.history.add(this.world, {
      type: 'error',
      elapsed,
      message,
    })
    this.scheduleRender()
  }

  destroy(): void {
    this.renderQueued = false
    this.lastHtml = ''
    this.el?.remove()
    this.el = null
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
    const html = renderStatusPanel(this.world, this.status, this.records, this.compactMode, this.historyLimit)
    if (html === this.lastHtml) {
      return
    }
    this.lastHtml = html
    this.el.innerHTML = html
  }
}
