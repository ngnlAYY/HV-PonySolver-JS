import type { AnswerCode } from '@hv-pony-solver/shared'
import type { HistoryRecord, World } from '../persistence/answer-history-types'
import { WORLD_NAMES } from '../persistence/answer-history-config'
import { escapeHtml } from '../utils/html'
import type { PanelStatus } from './status-panel-types'

export function formatAnswers(ponies: AnswerCode[], confidences: Partial<Record<AnswerCode, number>>): string {
  return ponies
    .map((pony) => {
      const confidence = confidences[pony]
      if (typeof confidence === 'number' && Number.isFinite(confidence)) {
        return `${pony}(${(confidence * 100).toFixed(1)})`
      }
      return pony
    })
    .join(',')
}

export function formatRecord(record: HistoryRecord): string {
  const time = escapeHtml(record.time || '')
  if (record.type === 'success') {
    return `${time} [${escapeHtml(record.answers)}] ${Number(record.elapsed) || 0}ms`
  }
  if (record.type === 'random') {
    return `${time} ${escapeHtml(record.message || '识别失败，随机选择')} ${Number(record.elapsed) || 0}ms`
  }
  return `${time} ${escapeHtml(record.message || '未知错误')}`
}

export function renderStatusPanel(world: World, status: PanelStatus, records: HistoryRecord[]): string {
  const worldName = WORLD_NAMES[world] || '未知'
  const rows = records.length ? records.map((record) => formatRecord(record)).join('<br>') : '暂无记录'
  return [
    'HV-PonySolver',
    '运行: 本地 ONNX',
    `模型状态：${escapeHtml(status.model)}`,
    `会话状态：${escapeHtml(status.session)}`,
    `推理状态：${escapeHtml(status.inference)}`,
    `当前处于<strong>${escapeHtml(worldName)}</strong>`,
    `${escapeHtml(worldName)}最近答题:`,
    rows,
  ].join('<br>')
}
