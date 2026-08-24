import { describe, expect, it } from 'vitest'

import { pickForwardedHostFields, sessionReadyStatus } from '../../src/host/status-fields'

describe('host status field helpers', () => {
  it('keeps only the non-empty Host-owned rows', () => {
    expect(pickForwardedHostFields({})).toEqual({})
    expect(pickForwardedHostFields({ inference: '推理中' })).toEqual({})
    expect(pickForwardedHostFields({ model: '', session: '' })).toEqual({})
    expect(pickForwardedHostFields({ model: '下载中', session: '初始化中', inference: '推理中' })).toEqual({
      model: '下载中',
      session: '初始化中',
    })
  })

  it('formats the session-ready text shared with the core panel', () => {
    expect(sessionReadyStatus(123)).toEqual({ session: '已就绪 123ms' })
    expect(sessionReadyStatus(Number.NaN)).toEqual({ session: '已就绪 0ms' })
  })
})
