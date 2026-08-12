import {
  getMultiClickDelayRange as getCoreMultiClickDelayRange,
  getMultiClickDelayRangeSync as getCoreMultiClickDelayRangeSync,
  getSubmitDelayRange as getCoreSubmitDelayRange,
  getSubmitDelayRangeSync as getCoreSubmitDelayRangeSync,
  serializeDelayRange,
  setMultiClickDelayRange as setCoreMultiClickDelayRange,
  setSubmitDelayRange as setCoreSubmitDelayRange,
  type DelayRange,
} from '@hv-pony-solver/browser-core'

import { alertUser, promptUser } from '../userscript/gm-bridge'
import { gmSettingsStorage } from '../userscript/gm-storage'

export type { DelayRange }

export function getSubmitDelayRangeSync(): DelayRange {
  return getCoreSubmitDelayRangeSync(gmSettingsStorage)
}

export function getMultiClickDelayRangeSync(): DelayRange {
  return getCoreMultiClickDelayRangeSync(gmSettingsStorage)
}

export function getSubmitDelayRange(): Promise<DelayRange> {
  return getCoreSubmitDelayRange(gmSettingsStorage)
}

export function getMultiClickDelayRange(): Promise<DelayRange> {
  return getCoreMultiClickDelayRange(gmSettingsStorage)
}

export function setSubmitDelayRange(value: string): Promise<void> {
  return setCoreSubmitDelayRange(gmSettingsStorage, value)
}

export function setMultiClickDelayRange(value: string): Promise<void> {
  return setCoreMultiClickDelayRange(gmSettingsStorage, value)
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
