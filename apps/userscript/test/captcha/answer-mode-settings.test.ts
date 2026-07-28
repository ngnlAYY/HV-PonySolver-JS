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
  vi.unstubAllGlobals()
  const testGlobal = globalThis as TestGlobal
  testGlobal.GM_getValue = gmGetValue
  testGlobal.GM_setValue = gmSetValue
  gmGetValue.mockReturnValue('')
  gmSetValue.mockResolvedValue(undefined)
})

describe('answer-mode-settings', () => {
  it('defaults to auto when storage is empty, invalid, or fails', async () => {
    const { getAnswerMode } = await import('../../src/captcha/answer-mode-settings')

    gmGetValue.mockReturnValueOnce('')
    await expect(getAnswerMode()).resolves.toBe('auto')
    gmGetValue.mockReturnValueOnce('unsupported')
    await expect(getAnswerMode()).resolves.toBe('auto')
    gmGetValue.mockImplementationOnce(() => {
      throw new Error('storage offline')
    })
    await expect(getAnswerMode()).resolves.toBe('auto')
  })

  it('reads and persists valid answer modes', async () => {
    const { getAnswerMode, setAnswerMode } = await import('../../src/captcha/answer-mode-settings')

    gmGetValue.mockReturnValueOnce('manual')
    await expect(getAnswerMode()).resolves.toBe('manual')
    gmGetValue.mockReturnValueOnce('auto')
    await expect(getAnswerMode()).resolves.toBe('auto')

    await setAnswerMode('manual')
    expect(gmSetValue).toHaveBeenCalledWith('hvPonySolverAnswerMode', 'manual')
  })

  it('uses the current mode as prompt default and saves a new mode', async () => {
    const prompt = vi.fn(() => '1')
    const alert = vi.fn()
    gmGetValue.mockReturnValueOnce('manual')
    vi.stubGlobal('prompt', prompt)
    vi.stubGlobal('alert', alert)
    const { setAnswerModeFromPrompt } = await import('../../src/captcha/answer-mode-settings')

    await setAnswerModeFromPrompt()

    expect(prompt).toHaveBeenCalledWith(expect.stringContaining('2. 仅识别，手动选择并提交'), '2')
    expect(gmSetValue).toHaveBeenCalledWith('hvPonySolverAnswerMode', 'auto')
    expect(alert).toHaveBeenCalledWith('答题模式已保存，从下一次验证码处理开始生效')
  })

  it('does nothing when the prompt is cancelled', async () => {
    vi.stubGlobal(
      'prompt',
      vi.fn(() => null),
    )
    const { setAnswerModeFromPrompt } = await import('../../src/captcha/answer-mode-settings')

    await setAnswerModeFromPrompt()

    expect(gmSetValue).not.toHaveBeenCalled()
  })

  it('rejects invalid prompt choices and propagates storage failures', async () => {
    vi.stubGlobal(
      'prompt',
      vi.fn(() => 'manual'),
    )
    const { setAnswerModeFromPrompt } = await import('../../src/captcha/answer-mode-settings')

    await expect(setAnswerModeFromPrompt()).rejects.toThrow('答题模式选项无效')
    expect(gmSetValue).not.toHaveBeenCalled()

    vi.stubGlobal(
      'prompt',
      vi.fn(() => '2'),
    )
    gmSetValue.mockRejectedValueOnce(new Error('write failed'))
    await expect(setAnswerModeFromPrompt()).rejects.toThrow('write failed')
  })
})
