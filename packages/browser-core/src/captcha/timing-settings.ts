import type { SettingsStorage } from '../platform/storage'
import { timingConfig } from './timing-config'

export type DelayRange = readonly [number, number]

export const SUBMIT_DELAY_STORAGE_KEY = 'hvPonySolverSubmitDelay'
export const MULTI_CLICK_DELAY_STORAGE_KEY = 'hvPonySolverMultiClickDelay'
const MIN_DELAY_MS = 0
const MAX_DELAY_MS = 30_000
const INVALID_DELAY_MESSAGE = '时间格式无效，请输入 0 到 30000 的毫秒数，或 min-max 范围'

export function parseDelayRange(value: string): DelayRange {
  const trimmed = value.trim()
  const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(trimmed)
  if (!match) {
    throw new Error(INVALID_DELAY_MESSAGE)
  }
  const min = Number(match[1])
  const max = Number(match[2] ?? match[1])
  if (min < MIN_DELAY_MS || max > MAX_DELAY_MS || min > max) {
    throw new Error(INVALID_DELAY_MESSAGE)
  }
  return [min, max]
}

export function serializeDelayRange(range: DelayRange): string {
  return range[0] === range[1] ? String(range[0]) : `${range[0]}-${range[1]}`
}

function getDelayRangeSync(storage: SettingsStorage, key: string, fallback: DelayRange): DelayRange {
  try {
    const saved = storage.getSync(key)
    return saved ? parseDelayRange(saved) : fallback
  } catch {
    return fallback
  }
}

async function getDelayRange(storage: SettingsStorage, key: string, fallback: DelayRange): Promise<DelayRange> {
  try {
    const saved = await storage.get(key)
    return saved ? parseDelayRange(saved) : fallback
  } catch {
    return fallback
  }
}

async function setDelayRange(storage: SettingsStorage, key: string, value: string): Promise<void> {
  await storage.set(key, serializeDelayRange(parseDelayRange(value)))
}

export function getSubmitDelayRangeSync(storage: SettingsStorage): DelayRange {
  return getDelayRangeSync(storage, SUBMIT_DELAY_STORAGE_KEY, timingConfig.submitDelay)
}

export function getMultiClickDelayRangeSync(storage: SettingsStorage): DelayRange {
  return getDelayRangeSync(storage, MULTI_CLICK_DELAY_STORAGE_KEY, timingConfig.multiClickDelay)
}

export async function getSubmitDelayRange(storage: SettingsStorage): Promise<DelayRange> {
  return getDelayRange(storage, SUBMIT_DELAY_STORAGE_KEY, timingConfig.submitDelay)
}

export async function getMultiClickDelayRange(storage: SettingsStorage): Promise<DelayRange> {
  return getDelayRange(storage, MULTI_CLICK_DELAY_STORAGE_KEY, timingConfig.multiClickDelay)
}

export async function setSubmitDelayRange(storage: SettingsStorage, value: string): Promise<void> {
  await setDelayRange(storage, SUBMIT_DELAY_STORAGE_KEY, value)
}

export async function setMultiClickDelayRange(storage: SettingsStorage, value: string): Promise<void> {
  await setDelayRange(storage, MULTI_CLICK_DELAY_STORAGE_KEY, value)
}
