import { describe, expect, it } from 'vitest'

import { sessionReadyStatus } from '../../src/host/status-fields'

describe('host status field helpers', () => {
  it('formats the session-ready text shared with the core panel', () => {
    expect(sessionReadyStatus(123)).toEqual({ session: '已就绪 123ms' })
    expect(sessionReadyStatus(Number.NaN)).toEqual({ session: '已就绪 0ms' })
  })
})
