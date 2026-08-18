import type { AnswerCode } from '@hv-pony-solver/shared/answer'
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
  return escapeHtml(formatRecordText(record))
}

function formatRecordText(record: HistoryRecord): string {
  const time = record.time || ''
  if (record.type === 'success') {
    return `${time} [${record.answers}] ${Number(record.elapsed) || 0}ms`
  }
  if (record.type === 'manual') {
    return `${time} [${record.answers}] 待手动提交 ${Number(record.elapsed) || 0}ms`
  }
  if (record.type === 'random') {
    return `${time} ${record.message || '识别失败，随机选择'} ${Number(record.elapsed) || 0}ms`
  }
  return `${time} ${record.message || '未知错误'} ${Number(record.elapsed) || 0}ms`
}

export function renderStatusPanelInto(
  element: HTMLElement,
  world: World,
  status: PanelStatus,
  records: HistoryRecord[],
  compactMode: boolean,
  historyLimit: number,
  persistenceError: string | null = null,
): void {
  const worldName = WORLD_NAMES[world] || '未知'
  const recentError = records.find((record) => record.type === 'error')?.message || '无'
  const lines: Array<string | Node> = ['HV-PonySolver', '运行: 本地 ONNX']
  if (!compactMode) {
    lines.push(`模型状态：${status.model}`, `会话状态：${status.session}`, `推理状态：${status.inference}`)
  }
  if (persistenceError) {
    lines.push(persistenceError)
  }
  lines.push(`最近错误：${recentError}`)
  const worldLine = document.createDocumentFragment()
  worldLine.append('当前处于')
  const strong = document.createElement('strong')
  strong.textContent = worldName
  worldLine.append(strong)
  lines.push(worldLine, `${worldName}最近答题:`)
  const visibleRecords = records.slice(0, historyLimit)
  lines.push(...(visibleRecords.length > 0 ? visibleRecords.map(formatRecordText) : ['暂无记录']))

  const fragment = document.createDocumentFragment()
  lines.forEach((line, index) => {
    if (index > 0) {
      fragment.append(document.createElement('br'))
    }
    fragment.append(line)
  })
  element.replaceChildren(fragment)
}

export function renderStatusPanel(
  world: World,
  status: PanelStatus,
  records: HistoryRecord[],
  compactMode: boolean,
  historyLimit: number,
  persistenceError: string | null = null,
): string {
  const worldName = WORLD_NAMES[world] || '未知'
  const visibleRecords = records.slice(0, historyLimit)
  const rows = visibleRecords.length ? visibleRecords.map((record) => formatRecord(record)).join('<br>') : '暂无记录'
  const recentError = records.find((record) => record.type === 'error')?.message || '无'
  const statusRows = compactMode
    ? []
    : [
        `模型状态：${escapeHtml(status.model)}`,
        `会话状态：${escapeHtml(status.session)}`,
        `推理状态：${escapeHtml(status.inference)}`,
      ]
  return [
    'HV-PonySolver',
    '运行: 本地 ONNX',
    ...statusRows,
    ...(persistenceError ? [escapeHtml(persistenceError)] : []),
    `最近错误：${escapeHtml(recentError)}`,
    `当前处于<strong>${escapeHtml(worldName)}</strong>`,
    `${escapeHtml(worldName)}最近答题:`,
    rows,
  ].join('<br>')
}
