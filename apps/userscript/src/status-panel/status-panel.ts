import type { AnswerCode } from '@hv-pony-solver/shared'
import { HistoryStore } from '../persistence/answer-history-store'
import type { World } from '../persistence/answer-history-types'
import type { PanelStatus, StatusPanel as StatusPanelContract } from './status-panel-types'
import { formatAnswers, renderStatusPanel } from './status-panel-renderer'

function getWorld(): World {
  return location.pathname.includes('/isekai/') ? 'isekai' : 'main'
}

export class StatusPanel implements StatusPanelContract {
  private el: HTMLDivElement | null = null
  private readonly world: World = getWorld()
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
    this.el = document.createElement('div')
    this.el.className = 'ponyLog'
    this.el.style.cssText = 'position:absolute;top:150px;left:1240px;font-size:12px;text-align:left'
    document.body.appendChild(this.el)
    this.render()
  }

  setStatus(changes: Partial<PanelStatus>): void {
    this.status = { ...this.status, ...changes }
    this.render()
  }

  setSessionReady(elapsed: number): void {
    this.setStatus({ session: `已就绪 ${Number(elapsed) || 0}ms` })
  }

  addSuccess(ponies: AnswerCode[], confidences: Partial<Record<AnswerCode, number>>, elapsed: number): void {
    this.history.add(this.world, {
      type: 'success',
      answers: formatAnswers(ponies, confidences),
      elapsed,
      message: '',
    })
    this.render()
  }

  addRandomFailure(pony: AnswerCode, elapsed: number): void {
    this.history.add(this.world, {
      type: 'random',
      answers: pony,
      elapsed,
      message: `识别失败，随机选择 ${pony}`,
    })
    this.render()
  }

  addError(message: string, elapsed = 0): void {
    this.history.add(this.world, {
      type: 'error',
      answers: '',
      elapsed,
      message,
    })
    this.render()
  }

  destroy(): void {
    this.el?.remove()
    this.el = null
  }

  private render(): void {
    if (!this.el) {
      return
    }
    this.el.innerHTML = renderStatusPanel(this.world, this.status, this.history.get(this.world))
  }
}
