import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/userscript/debug-settings', () => ({
  isDebugEnabled: vi.fn(() => false),
}))

import { isDebugEnabled } from '../../src/userscript/debug-settings'
import { log, logError, warn } from '../../src/utils/logger'

describe('logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(isDebugEnabled).mockReturnValue(false)
  })

  it('keeps debug logs disabled by default', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    log('hidden')

    expect(consoleLog).not.toHaveBeenCalled()
  })

  it('enables debug logs when debug setting is enabled', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.mocked(isDebugEnabled).mockReturnValue(true)

    log('visible')

    expect(consoleLog).toHaveBeenCalledWith('[PonySolverLocal]', 'visible')
  })

  it('keeps warnings and errors visible', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    warn('warning')
    logError('error')

    expect(consoleWarn).toHaveBeenCalledWith('[PonySolverLocal]', 'warning')
    expect(consoleError).toHaveBeenCalledWith('[PonySolverLocal]', 'error')
  })
})
