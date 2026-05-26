import { HISTORY_KEY, HISTORY_MAX } from './answer-history-config'
import type { HistoryRecord, HistoryRecordType, World } from './answer-history-types'
import { formatErrorMessage } from '../utils/errors'
import { isRecordObject } from '../utils/guards'
import { logError, warn } from '../utils/logger'
import { safeStorage } from '../userscript/gm-bridge'

function isHistoryRecordType(value: unknown): value is HistoryRecordType {
  return value === 'success' || value === 'random' || value === 'error'
}

function isHistoryRecord(value: unknown): value is HistoryRecord {
  if (!isRecordObject(value) || !isHistoryRecordType(value.type) || typeof value.elapsed !== 'number') {
    return false
  }
  const hasValidOptionalFields = (value.timestamp === undefined || typeof value.timestamp === 'number')
    && (value.time === undefined || typeof value.time === 'string')
  if (!hasValidOptionalFields) {
    return false
  }
  if (value.type === 'success') {
    return typeof value.answers === 'string'
  }
  if (value.type === 'random') {
    return typeof value.answers === 'string' && typeof value.message === 'string'
  }
  return typeof value.message === 'string'
}

function parseHistoryRoot(): Record<string, unknown> | null {
  const parsed: unknown = JSON.parse(safeStorage.getItem(HISTORY_KEY) || '{}')
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

  add(world: World, record: HistoryRecord): HistoryRecord[] {
    try {
      const root = parseHistoryRoot() ?? {}
      const list = getWorldRecords(root, world)
      const now = Date.now()
      const nextRecords = [
        {
          timestamp: now,
          time: new Date(now).toLocaleTimeString('zh-CN', { hour12: false }),
          ...record,
        },
        ...list,
      ].slice(0, HISTORY_MAX)
      safeStorage.setItem(HISTORY_KEY, JSON.stringify({
        ...root,
        [world]: nextRecords,
      }))
      return nextRecords
    } catch (error) {
      logError('保存记录失败:', formatErrorMessage(error))
      return this.get(world)
    }
  }
}
