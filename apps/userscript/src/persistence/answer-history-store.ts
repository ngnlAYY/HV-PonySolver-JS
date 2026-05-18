import { HISTORY_KEY, HISTORY_MAX } from './answer-history-config'
import type { HistoryRecord, HistoryRecordType, World } from './answer-history-types'
import { formatErrorMessage } from '../utils/errors'
import { logError, warn } from '../utils/logger'

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHistoryRecordType(value: unknown): value is HistoryRecordType {
  return value === 'success' || value === 'random' || value === 'error'
}

function isHistoryRecord(value: unknown): value is HistoryRecord {
  if (!isRecordObject(value) || !isHistoryRecordType(value.type)) {
    return false
  }
  const hasRequiredFields = typeof value.answers === 'string'
    && typeof value.elapsed === 'number'
    && typeof value.message === 'string'
  const hasValidOptionalFields = (value.timestamp === undefined || typeof value.timestamp === 'number')
    && (value.time === undefined || typeof value.time === 'string')
  return hasRequiredFields && hasValidOptionalFields
}

function parseHistoryRoot(): Record<string, unknown> | null {
  const parsed: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}')
  return isRecordObject(parsed) ? parsed : null
}

function getWorldRecords(root: Record<string, unknown>, world: World): HistoryRecord[] {
  const records = root[world]
  return Array.isArray(records) ? records.filter(isHistoryRecord) : []
}

export class HistoryStore {
  get(world: World): HistoryRecord[] {
    try {
      const root = parseHistoryRoot()
      return root ? getWorldRecords(root, world) : []
    } catch (error) {
      warn('读取记录失败:', formatErrorMessage(error))
      return []
    }
  }

  add(world: World, record: HistoryRecord): void {
    try {
      const root = parseHistoryRoot() ?? {}
      const list = getWorldRecords(root, world)
      const now = Date.now()
      const next = {
        ...root,
        [world]: [
          {
            timestamp: now,
            time: new Date(now).toLocaleTimeString('zh-CN', { hour12: false }),
            ...record,
          },
          ...list,
        ].slice(0, HISTORY_MAX),
      }
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
    } catch (error) {
      logError('保存记录失败:', formatErrorMessage(error))
    }
  }
}
