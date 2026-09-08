import {
  HISTORY_ENTRY_MAX_LENGTH,
  HISTORY_ENTRY_PREFIX,
  HISTORY_KEY,
  HISTORY_MAX,
  HISTORY_ROOT_MAX_LENGTH,
  HISTORY_TEXT_MAX_LENGTH,
} from './answer-history-config'
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

function isBoundedHistoryText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= HISTORY_TEXT_MAX_LENGTH
}

function isHistoryRecord(value: unknown): value is HistoryRecord {
  if (!isRecordObject(value) || !isHistoryRecordType(value.type) || !Number.isFinite(value.elapsed)) {
    return false
  }
  const hasValidOptionalFields =
    (value.sequence === undefined ||
      (typeof value.sequence === 'number' && Number.isSafeInteger(value.sequence) && value.sequence > 0)) &&
    (value.timestamp === undefined || Number.isFinite(value.timestamp)) &&
    (value.time === undefined || isBoundedHistoryText(value.time))
  if (!hasValidOptionalFields) {
    return false
  }
  if (value.type === 'success' || value.type === 'manual') {
    return isBoundedHistoryText(value.answers)
  }
  if (value.type === 'random') {
    return isBoundedHistoryText(value.answers) && isBoundedHistoryText(value.message)
  }
  return isBoundedHistoryText(value.message)
}

function parseHistoryRoot(raw: string | null): Record<string, unknown> | null {
  try {
    if (raw !== null && raw.length > HISTORY_ROOT_MAX_LENGTH) {
      return null
    }
    const parsed: unknown = JSON.parse(raw ?? '{}')
    return isRecordObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function getWorldRecords(root: Record<string, unknown>, world: World): HistoryRecord[] {
  const records = root[world]
  return Array.isArray(records) ? records.filter(isHistoryRecord).slice(0, HISTORY_MAX) : []
}

function isEnumerableTextStorage(storage: TextStorage): storage is EnumerableTextStorage {
  return typeof (storage as Partial<EnumerableTextStorage>).getItemsByPrefix === 'function'
}

function compareHistoryRecords(left: HistoryRecord, right: HistoryRecord): number {
  const sequenceDifference = (right.sequence ?? 0) - (left.sequence ?? 0)
  const leftTimestamp = Number.isFinite(left.timestamp) ? (left.timestamp ?? 0) : 0
  const rightTimestamp = Number.isFinite(right.timestamp) ? (right.timestamp ?? 0) : 0
  // 旧记录仍按时刻排序；序号和时刻均相同时保留稳定输入顺序。
  return sequenceDifference || rightTimestamp - leftTimestamp
}

function createHistoryEntryId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  fallbackEntrySequence += 1
  return `${Date.now().toString(36)}-${fallbackEntrySequence.toString(36)}-${Math.random().toString(36).slice(2)}`
}

function completeRecord(record: HistoryRecord, sequence: number): HistoryRecord {
  const now = Date.now()
  const base = {
    sequence,
    timestamp: typeof record.timestamp === 'number' && Number.isFinite(record.timestamp) ? record.timestamp : now,
    time: (record.time ?? new Date(now).toLocaleTimeString('zh-CN', { hour12: false })).slice(
      0,
      HISTORY_TEXT_MAX_LENGTH,
    ),
    elapsed: record.elapsed,
  }
  switch (record.type) {
    case 'success':
    case 'manual':
      return { ...base, type: record.type, answers: record.answers.slice(0, HISTORY_TEXT_MAX_LENGTH) }
    case 'random':
      return {
        ...base,
        type: record.type,
        answers: record.answers.slice(0, HISTORY_TEXT_MAX_LENGTH),
        message: record.message.slice(0, HISTORY_TEXT_MAX_LENGTH),
      }
    case 'error':
      return { ...base, type: record.type, message: record.message.slice(0, HISTORY_TEXT_MAX_LENGTH) }
  }
}

export class HistoryStore {
  private legacyRaw: string | null | undefined
  private legacyRoot: Record<string, unknown> | null = null
  private readonly parsedEntries = new Map<string, Readonly<{ raw: string; record: HistoryRecord | null }>>()
  private readonly sequences: Record<World, number> = { main: 0, isekai: 0 }
  constructor(
    private readonly storage: TextStorage,
    private readonly entryIdFactory: () => string = createHistoryEntryId,
  ) {}

  get(world: World): HistoryRecord[] {
    const legacyRecords = this.getLegacyRecords(world)
    if (!isEnumerableTextStorage(this.storage)) {
      return legacyRecords.map((record) => ({ ...record }))
    }
    return [...this.getKeyedRecords(this.storage, world).map(({ record }) => record), ...legacyRecords]
      .sort(compareHistoryRecords)
      .slice(0, HISTORY_MAX)
      .map((record) => ({ ...record }))
  }

  hasHistory(): boolean {
    // Only installs that produced at least one real answer count as
    // experienced: error/random-only history must not warm the session (and,
    // on remote editions, spend a monthly download slot) without proof of a
    // single usable inference.
    const hasUsableRecord = (world: World): boolean =>
      this.get(world).some((record) => record.type === 'success' || record.type === 'manual')
    return hasUsableRecord('main') || hasUsableRecord('isekai')
  }

  add(world: World, record: HistoryRecord): HistoryMutation {
    const currentRecords = this.get(world)
    const sequence =
      currentRecords.reduce((latest, current) => Math.max(latest, current.sequence ?? 0), this.sequences[world]) + 1
    if (!Number.isSafeInteger(sequence)) {
      return this.mutation(currentRecords, Promise.reject(new Error('历史记录排序序号已达到上限')))
    }
    // 先保留本实例序号，异步写入尚不可见时下一条记录也不能复用它。
    this.sequences[world] = sequence
    const completedRecord = completeRecord(record, sequence)
    if (isEnumerableTextStorage(this.storage)) {
      return this.addKeyed(world, completedRecord, this.storage, currentRecords)
    }
    return this.addLegacy(world, completedRecord)
  }

  private addKeyed(
    world: World,
    record: HistoryRecord,
    storage: EnumerableTextStorage,
    currentRecords: HistoryRecord[],
  ): HistoryMutation {
    const records = [record, ...currentRecords].sort(compareHistoryRecords).slice(0, HISTORY_MAX)
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
      root = this.readLegacyRoot() ?? {}
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
      const root = this.readLegacyRoot()
      return root ? getWorldRecords(root, world) : []
    } catch (error) {
      warn('读取记录失败:', formatErrorMessage(error))
      return []
    }
  }

  private readLegacyRoot(): Record<string, unknown> | null {
    const raw = this.storage.getItem(HISTORY_KEY)
    if (raw !== this.legacyRaw) {
      this.legacyRoot = parseHistoryRoot(raw)
      this.legacyRaw = raw !== null && raw.length > HISTORY_ROOT_MAX_LENGTH ? undefined : raw
    }
    return this.legacyRoot
  }

  private getKeyedRecords(
    storage: EnumerableTextStorage,
    world: World,
    invalidKeys: string[] = [],
  ): KeyedHistoryRecord[] {
    const records: KeyedHistoryRecord[] = []
    const prefix = `${HISTORY_ENTRY_PREFIX}${world}:`
    const presentKeys = new Set<string>()
    try {
      for (const [key, value] of storage.getItemsByPrefix(prefix)) {
        presentKeys.add(key)
        try {
          if (value.length > HISTORY_ENTRY_MAX_LENGTH) {
            this.parsedEntries.delete(key)
            invalidKeys.push(key)
            continue
          }
          let cached = this.parsedEntries.get(key)
          if (!cached || cached.raw !== value) {
            const parsed: unknown = JSON.parse(value)
            cached = { raw: value, record: isHistoryRecord(parsed) ? parsed : null }
            if (!this.parsedEntries.has(key) && this.parsedEntries.size >= HISTORY_MAX * 2) {
              const oldest = this.parsedEntries.keys().next().value
              if (oldest !== undefined) this.parsedEntries.delete(oldest)
            }
            this.parsedEntries.set(key, cached)
          }
          if (cached.record) {
            records.push({ key, record: cached.record })
          } else {
            invalidKeys.push(key)
          }
        } catch (error) {
          this.parsedEntries.delete(key)
          invalidKeys.push(key)
          warn('读取单条记录失败:', formatErrorMessage(error))
        }
      }
    } catch (error) {
      warn('读取单条记录列表失败:', formatErrorMessage(error))
    }
    for (const key of this.parsedEntries.keys()) {
      if (key.startsWith(prefix) && !presentKeys.has(key)) this.parsedEntries.delete(key)
    }
    return records.sort(
      (left, right) => compareHistoryRecords(left.record, right.record) || right.key.localeCompare(left.key),
    )
  }

  private async repairCorruptedLegacyRoot(storage: EnumerableTextStorage): Promise<void> {
    const raw = storage.getItem(HISTORY_KEY)
    if (raw === null) {
      return
    }
    try {
      if (this.readLegacyRoot() !== null) {
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
    const invalidKeys: string[] = []
    const staleKeys = this.getKeyedRecords(storage, world, invalidKeys)
      .slice(HISTORY_MAX)
      .map(({ key }) => key)
    for (const key of new Set([...invalidKeys, ...staleKeys])) {
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
