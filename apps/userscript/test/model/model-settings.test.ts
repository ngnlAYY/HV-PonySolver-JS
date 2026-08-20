import { beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'hvPonySolverModelAccessKey'

describe('model settings', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('reads an empty key by default', async () => {
    const { getModelAccessKey } = await import('../../src/model/model-settings')

    await expect(getModelAccessKey()).resolves.toBe('')
  })

  it('trims and persists model access keys through localStorage fallback', async () => {
    const { getModelAccessKey, setModelAccessKey } = await import('../../src/model/model-settings')

    await setModelAccessKey('  abc-123  ')

    expect(localStorage.getItem(STORAGE_KEY)).toBe('abc-123')
    await expect(getModelAccessKey()).resolves.toBe('abc-123')
  })

  it('clears saved model access keys through localStorage fallback', async () => {
    const { clearModelAccessKey, getModelAccessKey, setModelAccessKey } = await import('../../src/model/model-settings')

    await setModelAccessKey('abc-123')
    await clearModelAccessKey()

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    await expect(getModelAccessKey()).resolves.toBe('')
  })

  it('saves a prompted key immediately when verification is not configured', async () => {
    const prompt = vi.fn(() => '  direct-key  ')
    const alert = vi.fn()
    vi.stubGlobal('prompt', prompt)
    vi.stubGlobal('alert', alert)
    const { getModelAccessKey, setModelAccessKeyFromPrompt } = await import('../../src/model/model-settings')

    await setModelAccessKeyFromPrompt()

    await expect(getModelAccessKey()).resolves.toBe('direct-key')
    expect(alert).toHaveBeenCalledWith('模型下载 Key 已保存')
  })

  it('reports verification errors when called directly', async () => {
    const prompt = vi.fn(() => 'bad-key')
    const alert = vi.fn()
    const verify = vi.fn(async (_candidateKey: string) => {
      throw new Error('HTTP 403')
    })
    vi.stubGlobal('prompt', prompt)
    vi.stubGlobal('alert', alert)
    const { setModelAccessKeyFromPrompt } = await import('../../src/model/model-settings')

    await setModelAccessKeyFromPrompt(verify)

    expect(alert).toHaveBeenCalledWith('模型下载 Key 验证失败: Error: HTTP 403')
  })

  it('uses GM storage when available', async () => {
    const getValue = vi.fn(async () => 'gm-key')
    const setValue = vi.fn(async () => undefined)
    const deleteValue = vi.fn(async () => undefined)
    vi.stubGlobal('GM_getValue', getValue)
    vi.stubGlobal('GM_setValue', setValue)
    vi.stubGlobal('GM_deleteValue', deleteValue)
    const { clearModelAccessKey, getModelAccessKey, setModelAccessKey } = await import('../../src/model/model-settings')

    await expect(getModelAccessKey()).resolves.toBe('gm-key')
    await setModelAccessKey('  saved-gm-key  ')
    await clearModelAccessKey()

    expect(getValue).toHaveBeenCalledWith(STORAGE_KEY, '')
    expect(setValue).toHaveBeenCalledWith(STORAGE_KEY, 'saved-gm-key')
    expect(deleteValue).toHaveBeenCalledWith(STORAGE_KEY)
  })

})
