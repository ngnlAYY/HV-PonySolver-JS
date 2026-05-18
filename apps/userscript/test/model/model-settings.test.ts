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

  it('registers no menu commands when the userscript menu API is unavailable', async () => {
    const { registerModelSettingsMenu } = await import('../../src/model/model-settings')

    expect(() => registerModelSettingsMenu()).not.toThrow()
  })

  it('registers set and clear menu commands when available', async () => {
    const registerMenuCommand = vi.fn()
    vi.stubGlobal('GM_registerMenuCommand', registerMenuCommand)
    const { registerModelSettingsMenu } = await import('../../src/model/model-settings')

    registerModelSettingsMenu()

    expect(registerMenuCommand).toHaveBeenCalledTimes(2)
    expect(registerMenuCommand).toHaveBeenNthCalledWith(1, '设置模型下载 Key', expect.any(Function))
    expect(registerMenuCommand).toHaveBeenNthCalledWith(2, '清除模型下载 Key', expect.any(Function))
  })

  it('reports settings menu storage read failures without rejecting', async () => {
    const registerMenuCommand = vi.fn()
    const getValue = vi.fn(async () => {
      throw new Error('read failed')
    })
    const alert = vi.fn()
    vi.stubGlobal('GM_registerMenuCommand', registerMenuCommand)
    vi.stubGlobal('GM_getValue', getValue)
    vi.stubGlobal('alert', alert)
    const { registerModelSettingsMenu } = await import('../../src/model/model-settings')

    registerModelSettingsMenu()
    await expect(registerMenuCommand.mock.calls[0][1]()).resolves.toBeUndefined()

    expect(alert).toHaveBeenCalledWith('模型下载 Key 设置失败: Error: read failed')
  })

  it('reports clear menu storage failures without rejecting', async () => {
    const registerMenuCommand = vi.fn()
    const deleteValue = vi.fn(async () => {
      throw new Error('delete failed')
    })
    const alert = vi.fn()
    vi.stubGlobal('GM_registerMenuCommand', registerMenuCommand)
    vi.stubGlobal('GM_deleteValue', deleteValue)
    vi.stubGlobal('alert', alert)
    const { registerModelSettingsMenu } = await import('../../src/model/model-settings')

    registerModelSettingsMenu()
    await expect(registerMenuCommand.mock.calls[1][1]()).resolves.toBeUndefined()

    expect(alert).toHaveBeenCalledWith('模型下载 Key 设置失败: Error: delete failed')
  })

  it('keeps the existing key when the prompt is cancelled', async () => {
    const registerMenuCommand = vi.fn()
    const prompt = vi.fn(() => null)
    const alert = vi.fn()
    vi.stubGlobal('GM_registerMenuCommand', registerMenuCommand)
    vi.stubGlobal('prompt', prompt)
    vi.stubGlobal('alert', alert)
    const { getModelAccessKey, registerModelSettingsMenu, setModelAccessKey } = await import('../../src/model/model-settings')

    await setModelAccessKey('old-key')
    registerModelSettingsMenu()
    await registerMenuCommand.mock.calls[0][1]()

    expect(prompt).toHaveBeenCalledWith('请输入模型下载 Key', 'old-key')
    await expect(getModelAccessKey()).resolves.toBe('old-key')
    expect(alert).not.toHaveBeenCalled()
  })

  it('saves a non-empty prompted key and runs verification', async () => {
    const registerMenuCommand = vi.fn()
    const prompt = vi.fn(() => '  new-key  ')
    const alert = vi.fn()
    const verify = vi.fn(async () => undefined)
    vi.stubGlobal('GM_registerMenuCommand', registerMenuCommand)
    vi.stubGlobal('prompt', prompt)
    vi.stubGlobal('alert', alert)
    const { getModelAccessKey, registerModelSettingsMenu } = await import('../../src/model/model-settings')

    registerModelSettingsMenu(verify)
    await registerMenuCommand.mock.calls[0][1]()

    await expect(getModelAccessKey()).resolves.toBe('new-key')
    expect(verify).toHaveBeenCalledTimes(1)
    expect(alert).toHaveBeenCalledWith('正在验证模型下载 Key，请稍候')
    expect(alert).toHaveBeenCalledWith('模型下载和校验成功，Key 可用')
  })

  it('keeps a saved key and reports verification failure', async () => {
    const registerMenuCommand = vi.fn()
    const prompt = vi.fn(() => 'bad-key')
    const alert = vi.fn()
    const verify = vi.fn(async () => {
      throw new Error('HTTP 403')
    })
    vi.stubGlobal('GM_registerMenuCommand', registerMenuCommand)
    vi.stubGlobal('prompt', prompt)
    vi.stubGlobal('alert', alert)
    const { getModelAccessKey, registerModelSettingsMenu } = await import('../../src/model/model-settings')

    registerModelSettingsMenu(verify)
    await registerMenuCommand.mock.calls[0][1]()

    await expect(getModelAccessKey()).resolves.toBe('bad-key')
    expect(alert).toHaveBeenCalledWith('模型下载 Key 验证失败: Error: HTTP 403')
  })

  it('clears the key when the prompt returns only whitespace', async () => {
    const registerMenuCommand = vi.fn()
    const prompt = vi.fn(() => '   ')
    const alert = vi.fn()
    const verify = vi.fn()
    vi.stubGlobal('GM_registerMenuCommand', registerMenuCommand)
    vi.stubGlobal('prompt', prompt)
    vi.stubGlobal('alert', alert)
    const { getModelAccessKey, registerModelSettingsMenu, setModelAccessKey } = await import('../../src/model/model-settings')

    await setModelAccessKey('old-key')
    registerModelSettingsMenu(verify)
    await registerMenuCommand.mock.calls[0][1]()

    await expect(getModelAccessKey()).resolves.toBe('')
    expect(verify).not.toHaveBeenCalled()
    expect(alert).toHaveBeenCalledWith('模型下载 Key 已清除')
  })

  it('clears the key from the clear menu command', async () => {
    const registerMenuCommand = vi.fn()
    const alert = vi.fn()
    vi.stubGlobal('GM_registerMenuCommand', registerMenuCommand)
    vi.stubGlobal('alert', alert)
    const { getModelAccessKey, registerModelSettingsMenu, setModelAccessKey } = await import('../../src/model/model-settings')

    await setModelAccessKey('old-key')
    registerModelSettingsMenu()
    await registerMenuCommand.mock.calls[1][1]()

    await expect(getModelAccessKey()).resolves.toBe('')
    expect(alert).toHaveBeenCalledWith('模型下载 Key 已清除')
  })
})
