import { beforeEach, describe, expect, it, vi } from 'vitest'

const gmGetValue = vi.fn()
const gmSetValue = vi.fn(async () => undefined)

type TestGlobal = typeof globalThis & {
  GM_getValue?: typeof gmGetValue
  GM_setValue?: typeof gmSetValue
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  localStorage.clear()
  const testGlobal = globalThis as TestGlobal
  testGlobal.GM_getValue = gmGetValue
  testGlobal.GM_setValue = gmSetValue
  gmSetValue.mockResolvedValue(undefined)
})

describe('timing-settings', () => {
  it('falls back to default timing ranges when storage is empty', async () => {
    gmGetValue.mockReturnValue('')
    const { getSubmitDelayRangeSync, getMultiClickDelayRangeSync } = await import('../../src/captcha/timing-settings')

    expect(getSubmitDelayRangeSync()).toEqual([3000, 5000])
    expect(getMultiClickDelayRangeSync()).toEqual([1000, 1500])
  })

  it('reads fixed and ranged timing values from userscript storage', async () => {
    gmGetValue.mockImplementation((key: string) => (key === 'hvPonySolverSubmitDelay' ? '2500' : '300-800'))
    const { getSubmitDelayRangeSync, getMultiClickDelayRangeSync } = await import('../../src/captcha/timing-settings')

    expect(getSubmitDelayRangeSync()).toEqual([2500, 2500])
    expect(getMultiClickDelayRangeSync()).toEqual([300, 800])
  })

  it('falls back to defaults for invalid persisted timing values', async () => {
    gmGetValue.mockImplementation((key: string) => (key === 'hvPonySolverSubmitDelay' ? '5000-3000' : 'bad'))
    const { getSubmitDelayRangeSync, getMultiClickDelayRangeSync } = await import('../../src/captcha/timing-settings')

    expect(getSubmitDelayRangeSync()).toEqual([3000, 5000])
    expect(getMultiClickDelayRangeSync()).toEqual([1000, 1500])
  })

  it('saves canonical timing range values', async () => {
    const { setSubmitDelayRange, setMultiClickDelayRange } = await import('../../src/captcha/timing-settings')

    await setSubmitDelayRange('  2000 - 4500 ')
    await setMultiClickDelayRange('750')

    expect(gmSetValue).toHaveBeenCalledWith('hvPonySolverSubmitDelay', '2000-4500')
    expect(gmSetValue).toHaveBeenCalledWith('hvPonySolverMultiClickDelay', '750')
  })

  it('rejects invalid timing values', async () => {
    const { setSubmitDelayRange } = await import('../../src/captcha/timing-settings')

    await expect(setSubmitDelayRange('5000-3000')).rejects.toThrow('时间格式无效')
    await expect(setSubmitDelayRange('-1')).rejects.toThrow('时间格式无效')
    await expect(setSubmitDelayRange('30001')).rejects.toThrow('时间格式无效')
  })
})
