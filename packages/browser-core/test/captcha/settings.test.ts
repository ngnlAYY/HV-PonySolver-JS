import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_ANSWER_MODE,
  getAnswerMode,
  setAnswerMode,
} from '../../src/captcha/answer-mode-settings'
import { DEFAULT_RANDOM_ON_FAIL, getRandomOnFailSync } from '../../src/captcha/fallback-settings'
import { timingConfig } from '../../src/captcha/timing-config'
import {
  getMultiClickDelayRange,
  getMultiClickDelayRangeSync,
  getSubmitDelayRange,
  getSubmitDelayRangeSync,
  parseDelayRange,
  serializeDelayRange,
  setMultiClickDelayRange,
  setSubmitDelayRange,
} from '../../src/captcha/timing-settings'
import type { SettingsStorage } from '../../src/platform/storage'

function storage(initial: Record<string, string> = {}): SettingsStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getSync: (key) => values.get(key) ?? null,
    get: async (key) => values.get(key) ?? null,
    set: vi.fn(async (key, value) => {
      values.set(key, value)
    }),
    remove: vi.fn(async (key) => {
      values.delete(key)
    }),
  }
}

describe('portable captcha settings', () => {
  it('validates and serializes delay ranges', () => {
    expect(parseDelayRange('700')).toEqual([700, 700])
    expect(parseDelayRange('500 - 900')).toEqual([500, 900])
    expect(serializeDelayRange([500, 900])).toBe('500-900')
    expect(() => parseDelayRange('900-500')).toThrow('时间格式无效')
    expect(() => parseDelayRange('30001')).toThrow('时间格式无效')
  })

  it('reads and writes answer mode through injected storage', async () => {
    const store = storage()
    await expect(getAnswerMode(store)).resolves.toBe(DEFAULT_ANSWER_MODE)
    await setAnswerMode(store, 'manual')
    await expect(getAnswerMode(store)).resolves.toBe('manual')
    store.values.set('hvPonySolverAnswerMode', 'invalid')
    await expect(getAnswerMode(store)).resolves.toBe(DEFAULT_ANSWER_MODE)
  })

  it('preserves the random fallback default and explicit opt-out', () => {
    const store = storage()
    expect(getRandomOnFailSync(store)).toBe(DEFAULT_RANDOM_ON_FAIL)
    store.values.set('hvPonySolverRandomOnFail', '0')
    expect(getRandomOnFailSync(store)).toBe(false)
    store.values.set('hvPonySolverRandomOnFail', 'invalid')
    expect(getRandomOnFailSync(store)).toBe(DEFAULT_RANDOM_ON_FAIL)
  })

  it('reads, normalizes, and writes both timing ranges', async () => {
    const store = storage({
      hvPonySolverSubmitDelay: '2000 - 2500',
      hvPonySolverMultiClickDelay: '500',
    })
    expect(getSubmitDelayRangeSync(store)).toEqual([2000, 2500])
    expect(getMultiClickDelayRangeSync(store)).toEqual([500, 500])
    await expect(getSubmitDelayRange(store)).resolves.toEqual([2000, 2500])
    await expect(getMultiClickDelayRange(store)).resolves.toEqual([500, 500])

    await setSubmitDelayRange(store, '2200-2600')
    await setMultiClickDelayRange(store, '650')
    expect(store.values.get('hvPonySolverSubmitDelay')).toBe('2200-2600')
    expect(store.values.get('hvPonySolverMultiClickDelay')).toBe('650')
  })

  it('falls back when timing storage is invalid or unavailable', async () => {
    const invalid = storage({ hvPonySolverSubmitDelay: 'invalid', hvPonySolverMultiClickDelay: '40000' })
    expect(getSubmitDelayRangeSync(invalid)).toEqual(timingConfig.submitDelay)
    expect(getMultiClickDelayRangeSync(invalid)).toEqual(timingConfig.multiClickDelay)
    await expect(getSubmitDelayRange(invalid)).resolves.toEqual(timingConfig.submitDelay)
    await expect(getMultiClickDelayRange(invalid)).resolves.toEqual(timingConfig.multiClickDelay)

    const unavailable = storage()
    unavailable.getSync = () => {
      throw new Error('unavailable')
    }
    unavailable.get = async () => {
      throw new Error('unavailable')
    }
    expect(getSubmitDelayRangeSync(unavailable)).toEqual(timingConfig.submitDelay)
    await expect(getSubmitDelayRange(unavailable)).resolves.toEqual(timingConfig.submitDelay)
  })
})
