import { beforeEach, describe, expect, it, vi } from 'vitest'

import { log, logError, warn } from '../../src/utils/logger'

describe('logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('keeps debug logs disabled by default', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    log('hidden')

    expect(consoleLog).not.toHaveBeenCalled()
  })

  it('enables debug logs through localStorage', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    localStorage.setItem('hvPonySolverDebug', '1')

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
