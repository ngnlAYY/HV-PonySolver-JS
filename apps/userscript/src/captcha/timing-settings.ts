import { alertUser, getGmValue, getGmValueSync, promptUser, setGmValue } from '../userscript/gm-bridge'
import { timingConfig } from './timing-config'

export type DelayRange = readonly [number, number]

const SUBMIT_DELAY_STORAGE_KEY = 'hvPonySolverSubmitDelay'
const MULTI_CLICK_DELAY_STORAGE_KEY = 'hvPonySolverMultiClickDelay'
const MIN_DELAY_MS = 0
const MAX_DELAY_MS = 30_000
const INVALID_DELAY_MESSAGE = '时间格式无效，请输入 0 到 30000 的毫秒数，或 min-max 范围'

function parseDelayRange(value: string): DelayRange {
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

function serializeDelayRange(range: DelayRange): string {
  return range[0] === range[1] ? String(range[0]) : `${range[0]}-${range[1]}`
}

function getDelayRangeSync(key: string, fallback: DelayRange): DelayRange {
  try {
    const saved = getGmValueSync(key)
    return saved ? parseDelayRange(saved) : fallback
  } catch {
    return fallback
  }
}

async function getDelayRange(key: string, fallback: DelayRange): Promise<DelayRange> {
  try {
    const saved = await getGmValue(key)
    return saved ? parseDelayRange(saved) : fallback
  } catch {
    return fallback
  }
}

async function setDelayRange(key: string, value: string): Promise<void> {
  await setGmValue(key, serializeDelayRange(parseDelayRange(value)))
}

export function getSubmitDelayRangeSync(): DelayRange {
  return getDelayRangeSync(SUBMIT_DELAY_STORAGE_KEY, timingConfig.submitDelay)
}

export function getMultiClickDelayRangeSync(): DelayRange {
  return getDelayRangeSync(MULTI_CLICK_DELAY_STORAGE_KEY, timingConfig.multiClickDelay)
}

export async function getSubmitDelayRange(): Promise<DelayRange> {
  return getDelayRange(SUBMIT_DELAY_STORAGE_KEY, timingConfig.submitDelay)
}

export async function getMultiClickDelayRange(): Promise<DelayRange> {
  return getDelayRange(MULTI_CLICK_DELAY_STORAGE_KEY, timingConfig.multiClickDelay)
}

export async function setSubmitDelayRange(value: string): Promise<void> {
  await setDelayRange(SUBMIT_DELAY_STORAGE_KEY, value)
}

export async function setMultiClickDelayRange(value: string): Promise<void> {
  await setDelayRange(MULTI_CLICK_DELAY_STORAGE_KEY, value)
}

export async function setSubmitDelayRangeFromPrompt(): Promise<void> {
  const currentRange = await getSubmitDelayRange()
  const input = promptUser('请输入提交前等待毫秒数，或 min-max 范围', serializeDelayRange(currentRange))
  if (input === null) {
    return
  }
  await setSubmitDelayRange(input)
  alertUser('提交前等待时间已保存')
}

export async function setMultiClickDelayRangeFromPrompt(): Promise<void> {
  const currentRange = await getMultiClickDelayRange()
  const input = promptUser('请输入多选点击间隔毫秒数，或 min-max 范围', serializeDelayRange(currentRange))
  if (input === null) {
    return
  }
  await setMultiClickDelayRange(input)
  alertUser('答题间隔已保存')
}
