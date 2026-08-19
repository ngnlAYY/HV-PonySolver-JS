import { HISTORY_ENTRY_PREFIX, HISTORY_KEY, HISTORY_MAX } from './answer-history-config'
import type { HistoryRecord, HistoryRecordType, World } from './answer-history-types'
import type { EnumerableTextStorage, TextStorage } from '../platform/storage'
import { formatErrorMessage } from '../utils/errors'
import { isRecordObject } from '../utils/guards'
import { logError, warn } from '../utils/logger'

export type HistoryMutation = Readonly<{
  records: HistoryRecord[]
  persisted: Promise<HistoryRecord[]>
}>

type KeyedHistoryRecord = Readonly<{
  key: string
  record: HistoryRecord
}>

let fallbackEntrySequence = 0

function isHistoryRecordType(value: unknown): value is HistoryRecordType {
  return value === 'success' || value === 'manual' || value === 'random' || value === 'error'
}

function isHistoryRecord(value: unknown): value is HistoryRecord {
  if (!isRecordObject(value) || !isHistoryRecordType(value.type) || typeof value.elapsed !== 'number') {
    return false
  }
  const hasValidOptionalFields =
    (value.timestamp === undefined || typeof value.timestamp === 'number') &&
    (value.time === undefined || typeof value.time === 'string')
  if (!hasValidOptionalFields) {
    return false
  }
  if (value.type === 'success' || value.type === 'manual') {
    return typeof value.answers === 'string'
  }
  if (value.type === 'random') {
    return typeof value.answers === 'string' && typeof value.message === 'string'
  }
  return typeof value.message === 'string'
}

function parseHistoryRoot(storage: TextStorage): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(HISTORY_KEY) || '{}')
    return isRecordObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function getWorldRecords(root: Record<string, unknown>, world: World): HistoryRecord[] {
  const records = root[world]
  return Array.isArray(records) ? records.filter(isHistoryRecord) : []
}

function isEnumerableTextStorage(storage: TextStorage): storage is EnumerableTextStorage {
  return typeof (storage as Partial<EnumerableTextStorage>).getItemsByPrefix === 'function'
}

function sortHistoryRecords(records: HistoryRecord[]): HistoryRecord[] {
  return records
    .map((record, index) => ({ index, record }))
    .sort((left, right) => {
      const leftTimestamp = Number.isFinite(left.record.timestamp) ? (left.record.timestamp ?? 0) : 0
      const rightTimestamp = Number.isFinite(right.record.timestamp) ? (right.record.timestamp ?? 0) : 0
      return rightTimestamp - leftTimestamp || left.index - right.index
    })
    .map(({ record }) => record)
}

function createHistoryEntryId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  fallbackEntrySequence += 1
  return `${Date.now().toString(36)}-${fallbackEntrySequence.toString(36)}-${Math.random().toString(36).slice(2)}`
}

function completeRecord(record: HistoryRecord): HistoryRecord {
  const now = Date.now()
  return {
    timestamp: now,
    time: new Date(now).toLocaleTimeString('zh-CN', { hour12: false }),
    ...record,
  }
}

export class HistoryStore {
  constructor(
    private readonly storage: TextStorage,
    private readonly entryIdFactory: () => string = createHistoryEntryId,
  ) {}

  get(world: World): HistoryRecord[] {
    const legacyRecords = this.getLegacyRecords(world)
    if (!isEnumerableTextStorage(this.storage)) {
      return legacyRecords
    }
    return sortHistoryRecords([
      ...this.getKeyedRecords(this.storage, world).map(({ record }) => record),
      ...legacyRecords,
    ]).slice(0, HISTORY_MAX)
  }

  add(world: World, record: HistoryRecord): HistoryMutation {
    const completedRecord = completeRecord(record)
    if (isEnumerableTextStorage(this.storage)) {
      return this.addKeyed(world, completedRecord, this.storage)
    }
    return this.addLegacy(world, completedRecord)
  }

  private addKeyed(world: World, record: HistoryRecord, storage: EnumerableTextStorage): HistoryMutation {
    const records = sortHistoryRecords([record, ...this.get(world)]).slice(0, HISTORY_MAX)
    const entryKey = `${HISTORY_ENTRY_PREFIX}${world}:${this.entryIdFactory()}`
    let write: void | Promise<void>
    try {
      write = storage.setItem(entryKey, JSON.stringify(record))
    } catch (error) {
      return this.mutation(records, Promise.reject(error))
    }

    const persisted = Promise.resolve(write).then(async () => {
      await this.repairCorruptedLegacyRoot(storage)
      await this.trimKeyedHistory(storage, world)
      return this.get(world)
    })
    return this.mutation(records, persisted)
  }

  private addLegacy(world: World, record: HistoryRecord): HistoryMutation {
    let root: Record<string, unknown>
    try {
      root = parseHistoryRoot(this.storage) ?? {}
    } catch (error) {
      warn('读取损坏记录失败，将重建记录:', formatErrorMessage(error))
      root = {}
    }
    const records = [record, ...getWorldRecords(root, world)].slice(0, HISTORY_MAX)
    let write: void | Promise<void>
    try {
      write = this.storage.setItem(
        HISTORY_KEY,
        JSON.stringify({
          ...root,
          [world]: records,
        }),
      )
    } catch (error) {
      return this.mutation(records, Promise.reject(error))
    }
    return this.mutation(
      records,
      Promise.resolve(write).then(() => this.get(world)),
    )
  }

  private getLegacyRecords(world: World): HistoryRecord[] {
    try {
      const root = parseHistoryRoot(this.storage)
      return root ? getWorldRecords(root, world) : []
    } catch (error) {
      warn('读取记录失败:', formatErrorMessage(error))
      return []
    }
  }

  private getKeyedRecords(storage: EnumerableTextStorage, world: World): KeyedHistoryRecord[] {
    const records: KeyedHistoryRecord[] = []
    for (const [key, value] of storage.getItemsByPrefix(`${HISTORY_ENTRY_PREFIX}${world}:`)) {
      try {
        const parsed: unknown = JSON.parse(value)
        if (isHistoryRecord(parsed)) {
          records.push({ key, record: parsed })
        }
      } catch (error) {
        warn('读取单条记录失败:', formatErrorMessage(error))
      }
    }
    return records.sort((left, right) => {
      const leftTimestamp = Number.isFinite(left.record.timestamp) ? (left.record.timestamp ?? 0) : 0
      const rightTimestamp = Number.isFinite(right.record.timestamp) ? (right.record.timestamp ?? 0) : 0
      return rightTimestamp - leftTimestamp || right.key.localeCompare(left.key)
    })
  }

  private async repairCorruptedLegacyRoot(storage: EnumerableTextStorage): Promise<void> {
    const raw = storage.getItem(HISTORY_KEY)
    if (raw === null) {
      return
    }
    try {
      if (isRecordObject(JSON.parse(raw) as unknown)) {
        return
      }
    } catch {
      // The keyed history is already durable; remove only the unusable legacy value.
    }
    try {
      await storage.removeItem(HISTORY_KEY)
    } catch (error) {
      warn('清理损坏记录失败:', formatErrorMessage(error))
    }
  }

  private async trimKeyedHistory(storage: EnumerableTextStorage, world: World): Promise<void> {
    const staleRecords = this.getKeyedRecords(storage, world).slice(HISTORY_MAX)
    for (const { key } of staleRecords) {
      try {
        await storage.removeItem(key)
      } catch (error) {
        warn('清理过期记录失败:', formatErrorMessage(error))
      }
    }
  }

  private mutation(records: HistoryRecord[], persisted: Promise<HistoryRecord[]>): HistoryMutation {
    return {
      records,
      persisted: persisted.catch((error: unknown) => {
        logError('保存记录失败:', formatErrorMessage(error))
        throw error
      }),
    }
  }
}
