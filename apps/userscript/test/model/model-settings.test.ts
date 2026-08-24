import { beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'hvPonySolverModelAccessKey'
// The core setter enforces the Worker's token format (64 hex chars).
const VALID_TOKEN = 'A'.repeat(64)
const VALID_TOKEN_LOWER = VALID_TOKEN.toLowerCase()

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

  it('refuses to save keys through the page-readable localStorage fallback when GM storage is unavailable', async () => {
    const { setModelAccessKey } = await import('../../src/model/model-settings')

    await expect(setModelAccessKey(`  ${VALID_TOKEN}  `)).rejects.toThrow(
      '当前脚本管理器不支持 GM 存储，无法安全保存模型下载 Key；请改用支持 GM_setValue 的用户脚本管理器',
    )
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('trims and normalizes keys before persisting them through GM storage', async () => {
    const setValue = vi.fn(async () => undefined)
    vi.stubGlobal('GM_setValue', setValue)
    const { setModelAccessKey } = await import('../../src/model/model-settings')

    await setModelAccessKey(`  ${VALID_TOKEN}  `)

    expect(setValue).toHaveBeenCalledWith(STORAGE_KEY, VALID_TOKEN_LOWER)
  })

  it('rejects saving a key that does not match the token format', async () => {
    const { setModelAccessKey } = await import('../../src/model/model-settings')

    await expect(setModelAccessKey('abc-123')).rejects.toThrow('模型下载 Key 格式无效')
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('clears saved model access keys through GM storage', async () => {
    const setValue = vi.fn(async () => undefined)
    const deleteValue = vi.fn(async () => undefined)
    vi.stubGlobal('GM_setValue', setValue)
    vi.stubGlobal('GM_deleteValue', deleteValue)
    const { clearModelAccessKey, setModelAccessKey } = await import('../../src/model/model-settings')

    await setModelAccessKey(VALID_TOKEN)
    await clearModelAccessKey()

    expect(deleteValue).toHaveBeenCalledWith(STORAGE_KEY)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('saves a prompted key immediately when verification is not configured', async () => {
    const prompt = vi.fn(() => ` ${VALID_TOKEN} `)
    const alert = vi.fn()
    const store = new Map<string, string>()
    vi.stubGlobal('prompt', prompt)
    vi.stubGlobal('alert', alert)
    vi.stubGlobal(
      'GM_setValue',
      vi.fn(async (key: string, value: string) => {
        store.set(key, value)
      }),
    )
    vi.stubGlobal('GM_getValue', vi.fn(async (key: string, fallback: string) => store.get(key) ?? fallback))
    const { getModelAccessKey, setModelAccessKeyFromPrompt } = await import('../../src/model/model-settings')

    await setModelAccessKeyFromPrompt()

    await expect(getModelAccessKey()).resolves.toBe(VALID_TOKEN_LOWER)
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
    await setModelAccessKey(VALID_TOKEN)
    await clearModelAccessKey()

    expect(getValue).toHaveBeenCalledWith(STORAGE_KEY, '')
    expect(setValue).toHaveBeenCalledWith(STORAGE_KEY, VALID_TOKEN_LOWER)
    expect(deleteValue).toHaveBeenCalledWith(STORAGE_KEY)
  })
})
