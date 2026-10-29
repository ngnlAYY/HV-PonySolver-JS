import { beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'hvPonySolverModelAccessKey'
// The core setter enforces the Worker's token format (64 hex chars).
const VALID_TOKEN = 'aB'.repeat(32)
const VALID_TOKEN_LOWER = VALID_TOKEN.toLowerCase()

describe('model settings', () => {
  beforeEach(() => {
    // Import after resetModules so each case owns fresh Key intent and write-queue state.
    vi.resetModules()
    vi.restoreAllMocks()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('never reads a sensitive key from page-readable localStorage', async () => {
    localStorage.setItem(STORAGE_KEY, VALID_TOKEN_LOWER)
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

  it('trims keys and preserves their casing in GM storage', async () => {
    const setValue = vi.fn(async () => undefined)
    vi.stubGlobal('GM_setValue', setValue)
    const { setModelAccessKey } = await import('../../src/model/model-settings')

    await setModelAccessKey(`  ${VALID_TOKEN}  `)

    expect(setValue).toHaveBeenCalledWith(STORAGE_KEY, VALID_TOKEN)
  })

  it.each(['save', 'clear'])('keeps the latest %s after older GM writes settle', async (latest) => {
    const { clearModelAccessKey, getModelAccessKey, setModelAccessKey } = await import('../../src/model/model-settings')
    const firstCommit = Promise.withResolvers<void>()
    const store = new Map<string, string>()
    const onCommitted = vi.fn()
    const setValue = vi
      .fn(async (key: string, value: string) => {
        store.set(key, value)
      })
      .mockImplementationOnce(async (key, value) => {
        await firstCommit.promise
        store.set(key, value)
      })
    const deleteValue = vi.fn(async (key: string) => {
      store.delete(key)
    })
    vi.stubGlobal('GM', {
      getValue: async (key: string, fallback: string) => store.get(key) ?? fallback,
      setValue,
      deleteValue,
    })

    const older = setModelAccessKey(VALID_TOKEN, onCommitted)
    await vi.waitFor(() => expect(setValue).toHaveBeenCalledTimes(1))
    const middle = setModelAccessKey('cD'.repeat(32), onCommitted)
    const newest =
      latest === 'save' ? setModelAccessKey('eF'.repeat(32), onCommitted) : clearModelAccessKey(onCommitted)
    expect(onCommitted).not.toHaveBeenCalled()
    expect(setValue).toHaveBeenCalledTimes(1)
    expect(deleteValue).not.toHaveBeenCalled()

    firstCommit.resolve()
    await Promise.all([older, middle, newest])

    await expect(getModelAccessKey()).resolves.toBe(latest === 'save' ? 'eF'.repeat(32) : '')
    expect(onCommitted).toHaveBeenCalledTimes(3)
  })

  it('continues a queued clear after an older GM write rejects', async () => {
    const { clearModelAccessKey, getModelAccessKey, setModelAccessKey } = await import('../../src/model/model-settings')
    const firstCommit = Promise.withResolvers<void>()
    const store = new Map([[STORAGE_KEY, VALID_TOKEN_LOWER]])
    const onCommitted = vi.fn()
    const setValue = vi.fn(() => firstCommit.promise)
    vi.stubGlobal('GM', {
      getValue: async (key: string, fallback: string) => store.get(key) ?? fallback,
      setValue,
      deleteValue: async (key: string) => {
        store.delete(key)
      },
    })

    const older = setModelAccessKey(VALID_TOKEN, onCommitted)
    const rejected = expect(older).rejects.toThrow('模型下载 Key 保存失败，请检查脚本管理器的 GM 存储')
    await vi.waitFor(() => expect(setValue).toHaveBeenCalledTimes(1))
    const clearing = clearModelAccessKey(onCommitted)
    firstCommit.reject(new Error('GM write failed'))
    await rejected
    await clearing

    await expect(getModelAccessKey()).resolves.toBe('')
    expect(onCommitted).toHaveBeenCalledOnce()
  })

  it.each(['resolve', 'reject'])('does not block later writes while a commit callback waits to %s', async (outcome) => {
    const { clearModelAccessKey, getModelAccessKey, setModelAccessKey } = await import('../../src/model/model-settings')
    const callback = Promise.withResolvers<void>()
    const store = new Map<string, string>()
    const onCommitted = vi.fn(() => callback.promise)
    vi.stubGlobal('GM', {
      getValue: async (key: string, fallback: string) => store.get(key) ?? fallback,
      setValue: async (key: string, value: string) => {
        store.set(key, value)
      },
      deleteValue: async (key: string) => {
        store.delete(key)
      },
    })

    const saving = setModelAccessKey(VALID_TOKEN, onCommitted)
    const settled =
      outcome === 'resolve'
        ? expect(saving).resolves.toBeUndefined()
        : expect(saving).rejects.toThrow('recovery failed')
    await vi.waitFor(() => expect(onCommitted).toHaveBeenCalledOnce())
    await clearModelAccessKey()
    await expect(getModelAccessKey()).resolves.toBe('')

    if (outcome === 'resolve') callback.resolve()
    else callback.reject(new Error('recovery failed'))
    await settled
    await setModelAccessKey('cD'.repeat(32))
    await expect(getModelAccessKey()).resolves.toBe('cD'.repeat(32))
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
    vi.stubGlobal(
      'GM_getValue',
      vi.fn(async (key: string, fallback: string) => store.get(key) ?? fallback),
    )
    const { getModelAccessKey, setModelAccessKeyFromPrompt } = await import('../../src/model/model-settings')

    await setModelAccessKeyFromPrompt()

    await expect(getModelAccessKey()).resolves.toBe(VALID_TOKEN)
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

  it('can verify the saved value against the same historical mixed-case KV entry', async () => {
    const { getModelAccessTokenLookupKeys } = await import('@hv-pony-solver/shared/token')
    const store = new Map<string, string>()
    vi.stubGlobal('prompt', () => ` ${VALID_TOKEN} `)
    vi.stubGlobal('alert', vi.fn())
    vi.stubGlobal('GM_setValue', async (key: string, value: string) => {
      store.set(key, value)
    })
    vi.stubGlobal('GM_getValue', async (key: string, fallback: string) => store.get(key) ?? fallback)
    const verify = vi.fn(async (candidate: string) => {
      if (!getModelAccessTokenLookupKeys(candidate).includes(VALID_TOKEN)) throw new Error('HTTP 403')
    })
    const { getModelAccessKey, setModelAccessKeyFromPrompt } = await import('../../src/model/model-settings')

    await setModelAccessKeyFromPrompt(verify)

    expect(verify).toHaveBeenCalledExactlyOnceWith(VALID_TOKEN)
    await expect(verify(await getModelAccessKey())).resolves.toBeUndefined()
  })

  it('reports verification and storage completion without claiming a model download', async () => {
    const alert = vi.fn()
    const setValue = vi.fn(async () => undefined)
    const onCommitted = vi.fn(async () => undefined)
    const verify = vi.fn(async () => undefined)
    vi.stubGlobal('prompt', () => VALID_TOKEN)
    vi.stubGlobal('alert', alert)
    vi.stubGlobal('GM_setValue', setValue)
    const { setModelAccessKeyFromPrompt } = await import('../../src/model/model-settings')

    await setModelAccessKeyFromPrompt(verify, onCommitted)

    expect(verify).toHaveBeenCalledWith(VALID_TOKEN)
    expect(setValue).toHaveBeenCalledWith(STORAGE_KEY, VALID_TOKEN)
    expect(onCommitted).toHaveBeenCalledExactlyOnceWith()
    expect(alert).toHaveBeenLastCalledWith('模型下载 Key 已验证并保存')
  })

  it.each(['verified', 'quota', 'rejected'])(
    'ignores a late %s verification after clearing the Key',
    async (outcome) => {
      const { ModelDownloadQuotaExceededError } = await import('@hv-pony-solver/browser-core')
      const { clearSavedModelAccessKey, setModelAccessKeyFromPrompt } = await import('../../src/model/model-settings')
      const store = new Map<string, string>()
      const alert = vi.fn()
      const onCommitted = vi.fn()
      vi.stubGlobal('prompt', () => VALID_TOKEN)
      vi.stubGlobal('alert', alert)
      vi.stubGlobal('GM_setValue', async (key: string, value: string) => {
        store.set(key, value)
      })
      vi.stubGlobal('GM_deleteValue', async (key: string) => {
        store.delete(key)
      })
      let settle = () => {}
      const verification = new Promise<void>((resolve, reject) => {
        settle =
          outcome === 'verified'
            ? resolve
            : () => reject(outcome === 'quota' ? new ModelDownloadQuotaExceededError(60) : new Error('HTTP 403'))
      })
      const pending = setModelAccessKeyFromPrompt(() => verification, onCommitted)

      await clearSavedModelAccessKey(onCommitted)
      alert.mockClear()
      onCommitted.mockClear()
      settle()
      await pending

      expect(store.size).toBe(0)
      expect(alert).not.toHaveBeenCalled()
      expect(onCommitted).not.toHaveBeenCalled()
    },
  )

  it('does not let an older verification overwrite a newer saved Key', async () => {
    const { setModelAccessKeyFromPrompt } = await import('../../src/model/model-settings')
    const setValue = vi.fn(async () => undefined)
    const prompt = vi.fn().mockReturnValueOnce(VALID_TOKEN).mockReturnValueOnce('cD'.repeat(32))
    vi.stubGlobal('prompt', prompt)
    vi.stubGlobal('alert', vi.fn())
    vi.stubGlobal('GM_setValue', setValue)
    let finish = () => {}
    const verification = new Promise<void>((resolve) => {
      finish = resolve
    })
    const older = setModelAccessKeyFromPrompt(() => verification)
    await setModelAccessKeyFromPrompt(async () => undefined)

    finish()
    await older

    expect(setValue).toHaveBeenCalledExactlyOnceWith(STORAGE_KEY, 'cD'.repeat(32))
  })

  it('discards a verified Key queued behind a GM write when a newer verification starts', async () => {
    const { getModelAccessKey, setModelAccessKey, setModelAccessKeyFromPrompt } =
      await import('../../src/model/model-settings')
    const firstCommit = Promise.withResolvers<void>()
    const newestVerification = Promise.withResolvers<void>()
    const stored = new Map<string, string>()
    const setValue = vi.fn(async (key: string, value: string) => {
      if (value === VALID_TOKEN) await firstCommit.promise
      stored.set(key, value)
    })
    vi.stubGlobal('GM_setValue', setValue)
    vi.stubGlobal('GM_getValue', (key: string, fallback: string) => stored.get(key) ?? fallback)
    vi.stubGlobal('prompt', vi.fn().mockReturnValueOnce('cD'.repeat(32)).mockReturnValueOnce('eF'.repeat(32)))
    vi.stubGlobal('alert', vi.fn())
    const staleCommitted = vi.fn()

    const first = setModelAccessKey(VALID_TOKEN)
    await vi.waitFor(() => expect(setValue).toHaveBeenCalledOnce())
    const stale = setModelAccessKeyFromPrompt(async () => undefined, staleCommitted)
    await Promise.resolve()
    const newest = setModelAccessKeyFromPrompt(() => newestVerification.promise)
    firstCommit.resolve()
    await Promise.all([first, stale])

    expect(setValue).toHaveBeenCalledExactlyOnceWith(STORAGE_KEY, VALID_TOKEN)
    expect(staleCommitted).not.toHaveBeenCalled()
    expect(globalThis.alert).not.toHaveBeenCalledWith('模型下载 Key 已验证并保存')
    await expect(getModelAccessKey()).resolves.toBe(VALID_TOKEN)

    newestVerification.resolve()
    await newest
    await expect(getModelAccessKey()).resolves.toBe('eF'.repeat(32))
  })

  it('keeps a pending verification when a later prompt is cancelled', async () => {
    const { setModelAccessKeyFromPrompt } = await import('../../src/model/model-settings')
    const setValue = vi.fn(async () => undefined)
    vi.stubGlobal('prompt', vi.fn().mockReturnValueOnce(VALID_TOKEN).mockReturnValueOnce(null))
    vi.stubGlobal('alert', vi.fn())
    vi.stubGlobal('GM_setValue', setValue)
    let finish = () => {}
    const verification = new Promise<void>((resolve) => {
      finish = resolve
    })
    const older = setModelAccessKeyFromPrompt(() => verification)
    await setModelAccessKeyFromPrompt(async () => undefined)

    finish()
    await older

    expect(setValue).toHaveBeenCalledExactlyOnceWith(STORAGE_KEY, VALID_TOKEN)
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
    expect(setValue).toHaveBeenCalledWith(STORAGE_KEY, VALID_TOKEN)
    expect(deleteValue).toHaveBeenCalledWith(STORAGE_KEY)
  })

  it('shows the saved Key monthly quota without spending a download', async () => {
    const alert = vi.fn()
    vi.stubGlobal('alert', alert)
    vi.stubGlobal(
      'GM_getValue',
      vi.fn(async () => VALID_TOKEN_LOWER),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ enabled: true, limit: 5, used: 2, remaining: 3, retryAfterSeconds: 3600 })),
    )
    const { querySavedModelDownloadQuota } = await import('../../src/model/model-settings')

    await querySavedModelDownloadQuota()

    expect(alert).toHaveBeenCalledWith('本月模型下载额度：已用 2/5 次，剩余 3 次')
  })

  it('shows no limit when the Worker was built without quota enforcement', async () => {
    const alert = vi.fn()
    vi.stubGlobal('alert', alert)
    vi.stubGlobal(
      'GM_getValue',
      vi.fn(async () => VALID_TOKEN_LOWER),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ enabled: false, limit: 0, used: 0, remaining: null, retryAfterSeconds: null })),
    )
    const { querySavedModelDownloadQuota } = await import('../../src/model/model-settings')

    await querySavedModelDownloadQuota()

    expect(alert).toHaveBeenCalledWith('无次数限制（模型下载次数限制未开启）')
  })
})
