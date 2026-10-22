import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ANSWER_MODE_STORAGE_KEY,
  MULTI_CLICK_DELAY_STORAGE_KEY,
  PANEL_COMPACT_MODE_STORAGE_KEY,
  PANEL_CSP_VISIBILITY_STORAGE_KEY,
  PANEL_POSITION_STORAGE_KEY,
  PRESERVE_CHECKED_ANSWERS_STORAGE_KEY,
  RANDOM_ON_FAIL_STORAGE_KEY,
  SUBMIT_DELAY_STORAGE_KEY,
} from '@hv-pony-solver/browser-core'

import { installOptionsPageMarkup, optionsElement } from './options-page-fixture'

const platformMocks = vi.hoisted(() => ({
  storageGetAll: vi.fn(),
  storageSet: vi.fn(),
}))

vi.mock('../../src/platform/webextension', () => platformMocks)

function submitForm(): void {
  optionsElement<HTMLFormElement>('settings-form').dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  )
}

async function installAndLoad(values: Record<string, unknown> = {}): Promise<ReturnType<typeof vi.fn>> {
  platformMocks.storageGetAll.mockResolvedValueOnce(values)
  const { installOrdinarySettingsController } = await import('../../src/options/ordinary-settings')
  const status = vi.fn()
  const controller = installOrdinarySettingsController({ set: status })
  await controller.load()
  return status
}

beforeEach(() => {
  vi.resetModules()
  platformMocks.storageGetAll.mockReset().mockResolvedValue({})
  platformMocks.storageSet.mockReset().mockResolvedValue(undefined)
  installOptionsPageMarkup()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ordinary options settings lifecycle', () => {
  it('keeps Save disabled during a slow load and preserves edits made before it completes', async () => {
    let resolveLoad: ((values: Record<string, unknown>) => void) | undefined
    platformMocks.storageGetAll.mockReturnValueOnce(
      new Promise<Record<string, unknown>>((resolve) => {
        resolveLoad = resolve
      }),
    )
    const { installOrdinarySettingsController } = await import('../../src/options/ordinary-settings')
    const controller = installOrdinarySettingsController({ set: vi.fn() })
    const saveButton = document.querySelector<HTMLButtonElement>('button[type="submit"]')
    const answerMode = optionsElement<HTMLSelectElement>('answer-mode')
    const submitDelay = optionsElement<HTMLInputElement>('submit-delay')
    const panelPosition = optionsElement<HTMLInputElement>('panel-position')

    const load = controller.load()
    expect(saveButton?.disabled).toBe(true)
    answerMode.value = 'manual'
    answerMode.dispatchEvent(new Event('change', { bubbles: true }))
    panelPosition.value = '10,20'
    resolveLoad?.({
      [ANSWER_MODE_STORAGE_KEY]: 'auto',
      [SUBMIT_DELAY_STORAGE_KEY]: '2400-2600',
      [PANEL_POSITION_STORAGE_KEY]: '30,40',
    })
    await load

    expect(answerMode.value).toBe('manual')
    expect(submitDelay.value).toBe('2400-2600')
    expect(panelPosition.value).toBe('10,20')
    expect(saveButton?.disabled).toBe(false)
  })

  it.each([false, true])(
    'preserves initial-value select and checkbox edits before load completes (retry: %s)',
    async (failFirstLoad) => {
      // Import after vi.resetModules() so each case uses an isolated mocked platform module graph.
      const { installOrdinarySettingsController } = await import('../../src/options/ordinary-settings')
      const controller = installOrdinarySettingsController({ set: vi.fn() })
      const answerMode = optionsElement<HTMLSelectElement>('answer-mode')
      const compact = optionsElement<HTMLInputElement>('panel-compact')
      const submitDelay = optionsElement<HTMLInputElement>('submit-delay')
      const requireCsp = optionsElement<HTMLInputElement>('panel-require-csp')
      const saveButton = document.querySelector<HTMLButtonElement>('button[type="submit"]')
      const storedValues = {
        [ANSWER_MODE_STORAGE_KEY]: 'manual',
        [PANEL_COMPACT_MODE_STORAGE_KEY]: '1',
        [SUBMIT_DELAY_STORAGE_KEY]: '2400-2600',
        [PANEL_CSP_VISIBILITY_STORAGE_KEY]: '0',
      }
      platformMocks.storageGetAll.mockReturnValueOnce(
        failFirstLoad ? Promise.reject(new Error('load failed')) : Promise.resolve(storedValues),
      )

      const load = controller.load()
      answerMode.value = 'manual'
      answerMode.dispatchEvent(new Event('change', { bubbles: true }))
      answerMode.value = 'auto'
      answerMode.dispatchEvent(new Event('change', { bubbles: true }))
      compact.checked = true
      compact.dispatchEvent(new Event('input', { bubbles: true }))
      compact.checked = false
      compact.dispatchEvent(new Event('input', { bubbles: true }))

      if (failFirstLoad) {
        await expect(load).rejects.toThrow('load failed')
        expect(saveButton?.disabled).toBe(true)
        submitForm()
        expect(platformMocks.storageSet).not.toHaveBeenCalled()
        platformMocks.storageGetAll.mockResolvedValueOnce(storedValues)
        await controller.load()
      } else {
        await load
      }

      expect(answerMode.value).toBe('auto')
      expect(compact.checked).toBe(false)
      expect(submitDelay.value).toBe('2400-2600')
      expect(requireCsp.checked).toBe(false)
      expect(saveButton?.disabled).toBe(false)
      answerMode.value = 'manual'
      answerMode.dispatchEvent(new Event('change', { bubbles: true }))
      compact.checked = true
      compact.dispatchEvent(new Event('input', { bubbles: true }))
      submitForm()
      expect(saveButton?.disabled).toBe(false)
      await Promise.resolve()
      expect(platformMocks.storageSet).not.toHaveBeenCalled()

      answerMode.value = 'auto'
      answerMode.dispatchEvent(new Event('change', { bubbles: true }))
      compact.checked = false
      compact.dispatchEvent(new Event('input', { bubbles: true }))
      submitForm()

      await vi.waitFor(() => expect(platformMocks.storageSet).toHaveBeenCalledTimes(1))
      expect(platformMocks.storageSet).toHaveBeenCalledWith({
        [ANSWER_MODE_STORAGE_KEY]: 'auto',
        [PANEL_COMPACT_MODE_STORAGE_KEY]: '0',
      })
    },
  )

  it('writes only dirty fields after another options page changes an unedited field', async () => {
    await installAndLoad({
      [ANSWER_MODE_STORAGE_KEY]: 'auto',
      [SUBMIT_DELAY_STORAGE_KEY]: '3000-5000',
      [MULTI_CLICK_DELAY_STORAGE_KEY]: '1000-1500',
      [PANEL_POSITION_STORAGE_KEY]: '155,1240',
      [RANDOM_ON_FAIL_STORAGE_KEY]: '1',
    })
    const answerMode = optionsElement<HTMLSelectElement>('answer-mode')
    answerMode.value = 'manual'
    answerMode.dispatchEvent(new Event('change', { bubbles: true }))

    // A second options page can update this key without being overwritten by this save.
    await platformMocks.storageSet({ [MULTI_CLICK_DELAY_STORAGE_KEY]: '50' })
    platformMocks.storageSet.mockClear()
    submitForm()

    await vi.waitFor(() => expect(platformMocks.storageSet).toHaveBeenCalledTimes(1))
    expect(platformMocks.storageSet).toHaveBeenCalledWith({ [ANSWER_MODE_STORAGE_KEY]: 'manual' })
  })

  it('commits compact and ordinary edits in one storage operation', async () => {
    await installAndLoad({ [PANEL_COMPACT_MODE_STORAGE_KEY]: '0' })
    const answerMode = optionsElement<HTMLSelectElement>('answer-mode')
    const compact = optionsElement<HTMLInputElement>('panel-compact')
    answerMode.value = 'manual'
    answerMode.dispatchEvent(new Event('change', { bubbles: true }))
    compact.checked = true
    compact.dispatchEvent(new Event('change', { bubbles: true }))

    submitForm()

    await vi.waitFor(() => expect(platformMocks.storageSet).toHaveBeenCalledTimes(1))
    expect(platformMocks.storageSet).toHaveBeenCalledWith({
      [ANSWER_MODE_STORAGE_KEY]: 'manual',
      [PANEL_COMPACT_MODE_STORAGE_KEY]: '1',
    })
  })

  it('retains dirty fields after a storage failure and lets the user retry', async () => {
    const status = await installAndLoad()
    const answerMode = optionsElement<HTMLSelectElement>('answer-mode')
    const saveButton = document.querySelector<HTMLButtonElement>('button[type="submit"]')
    answerMode.value = 'manual'
    answerMode.dispatchEvent(new Event('change', { bubbles: true }))
    platformMocks.storageSet.mockRejectedValueOnce(new Error('storage failed'))

    submitForm()
    // formatErrorMessage (browser-core) prefixes the class name, matching the panel rendering.
    await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith('Error: storage failed', true))
    expect(saveButton?.disabled).toBe(false)
    expect(platformMocks.storageSet).toHaveBeenCalledTimes(1)

    platformMocks.storageSet.mockResolvedValueOnce(undefined)
    submitForm()
    await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith('设置已保存；已打开的游戏页面刷新后应用全部设置'))
    expect(platformMocks.storageSet).toHaveBeenCalledTimes(2)
    expect(platformMocks.storageSet).toHaveBeenLastCalledWith({ [ANSWER_MODE_STORAGE_KEY]: 'manual' })
  })

  it('shows the shared-formatter text for errors carrying the userMessage channel', async () => {
    const status = await installAndLoad()
    const answerMode = optionsElement<HTMLSelectElement>('answer-mode')
    answerMode.value = 'manual'
    answerMode.dispatchEvent(new Event('change', { bubbles: true }))
    const permanentLike = Object.assign(new Error('internal detail'), {
      name: 'PermanentModelError',
      userMessage: '模型 Key 无效或已失效，请在设置中重新验证 Key',
    })
    platformMocks.storageSet.mockRejectedValueOnce(permanentLike)

    submitForm()

    // formatErrorMessage renders the userMessage channel verbatim, matching the panel.
    await vi.waitFor(() =>
      expect(status).toHaveBeenLastCalledWith('模型 Key 无效或已失效，请在设置中重新验证 Key', true),
    )
  })

  it('serializes rapid submits and applies the newest intent last', async () => {
    await installAndLoad()
    const panelPosition = optionsElement<HTMLInputElement>('panel-position')
    const saveButton = document.querySelector<HTMLButtonElement>('button[type="submit"]')
    let resolveFirst: (() => void) | undefined
    let resolveSecond: (() => void) | undefined
    platformMocks.storageSet
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveSecond = resolve
          }),
      )

    panelPosition.value = '10,20'
    panelPosition.dispatchEvent(new Event('input', { bubbles: true }))
    submitForm()
    await vi.waitFor(() => expect(platformMocks.storageSet).toHaveBeenCalledTimes(1))
    panelPosition.value = '30,40'
    panelPosition.dispatchEvent(new Event('input', { bubbles: true }))
    submitForm()

    expect(saveButton?.disabled).toBe(true)
    resolveFirst?.()
    await vi.waitFor(() => expect(platformMocks.storageSet).toHaveBeenCalledTimes(2))
    expect(platformMocks.storageSet).toHaveBeenNthCalledWith(1, { [PANEL_POSITION_STORAGE_KEY]: '10,20' })
    expect(platformMocks.storageSet).toHaveBeenNthCalledWith(2, { [PANEL_POSITION_STORAGE_KEY]: '30,40' })
    resolveSecond?.()
    await vi.waitFor(() => expect(saveButton?.disabled).toBe(false))
  })

  it.each([
    ['success', true],
    ['failure', true],
    ['failure', false],
  ] as const)(
    'preserves the newest submit during a pending %s (restore baseline: %s)',
    async (outcome, restoreBaseline) => {
      const status = await installAndLoad({
        [PANEL_POSITION_STORAGE_KEY]: '155,1240',
        [PANEL_COMPACT_MODE_STORAGE_KEY]: '0',
      })
      const panelPosition = optionsElement<HTMLInputElement>('panel-position')
      const compact = optionsElement<HTMLInputElement>('panel-compact')
      let resolveFirst: (() => void) | undefined
      let rejectFirst: ((error: Error) => void) | undefined
      platformMocks.storageSet.mockReturnValueOnce(
        new Promise<void>((resolve, reject) => {
          resolveFirst = resolve
          rejectFirst = reject
        }),
      )

      panelPosition.value = '10,20'
      panelPosition.dispatchEvent(new Event('input', { bubbles: true }))
      compact.checked = true
      compact.dispatchEvent(new Event('change', { bubbles: true }))
      submitForm()
      await vi.waitFor(() => expect(platformMocks.storageSet).toHaveBeenCalledTimes(1))
      const desiredPosition = restoreBaseline ? '155,1240' : '10,20'
      const desiredCompact = !restoreBaseline

      panelPosition.value = desiredPosition
      panelPosition.dispatchEvent(new Event('input', { bubbles: true }))
      compact.checked = desiredCompact
      compact.dispatchEvent(new Event('change', { bubbles: true }))
      submitForm()
      expect(status).toHaveBeenLastCalledWith('正在保存设置…')
      if (outcome === 'success') resolveFirst?.()
      else rejectFirst?.(new Error('first write failed'))

      await vi.waitFor(() => expect(platformMocks.storageSet).toHaveBeenCalledTimes(2))
      expect(platformMocks.storageSet).toHaveBeenLastCalledWith({
        [PANEL_POSITION_STORAGE_KEY]: desiredPosition,
        [PANEL_COMPACT_MODE_STORAGE_KEY]: desiredCompact ? '1' : '0',
      })
      await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith('设置已保存；已打开的游戏页面刷新后应用全部设置'))
      expect(panelPosition.value).toBe(desiredPosition)
      expect(compact.checked).toBe(desiredCompact)
      submitForm()
      expect(status).toHaveBeenLastCalledWith('设置未修改')
      expect(platformMocks.storageSet).toHaveBeenCalledTimes(2)
    },
  )

  it('uses parser defaults when random fallback and panel position storage are corrupt', async () => {
    await installAndLoad({
      [RANDOM_ON_FAIL_STORAGE_KEY]: 'corrupt',
      [PRESERVE_CHECKED_ANSWERS_STORAGE_KEY]: 'corrupt',
      [PANEL_POSITION_STORAGE_KEY]: '999999999999999999999999,20',
    })

    expect(optionsElement<HTMLInputElement>('random-on-fail').checked).toBe(true)
    expect(optionsElement<HTMLInputElement>('preserve-checked-answers').checked).toBe(true)
    expect(optionsElement<HTMLInputElement>('panel-position').value).toBe('155,1240')
  })

  it('defaults to preserving checked answers and persists the opt-out', async () => {
    await installAndLoad()
    const preserve = optionsElement<HTMLInputElement>('preserve-checked-answers')
    expect(preserve.checked).toBe(true)

    preserve.checked = false
    preserve.dispatchEvent(new Event('change', { bubbles: true }))
    submitForm()

    await vi.waitFor(() =>
      expect(platformMocks.storageSet).toHaveBeenCalledWith({
        [PRESERVE_CHECKED_ANSWERS_STORAGE_KEY]: '0',
      }),
    )
  })

  it('defaults to requiring div#csp for panel visibility and persists the opt-out', async () => {
    await installAndLoad()
    const requireCsp = optionsElement<HTMLInputElement>('panel-require-csp')
    expect(requireCsp.checked).toBe(true)

    requireCsp.checked = false
    requireCsp.dispatchEvent(new Event('change', { bubbles: true }))
    submitForm()

    await vi.waitFor(() =>
      expect(platformMocks.storageSet).toHaveBeenCalledWith({
        [PANEL_CSP_VISIBILITY_STORAGE_KEY]: '0',
      }),
    )
  })
})
