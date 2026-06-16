import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logError, warn } from '../../src/utils/logger'

describe('logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
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
