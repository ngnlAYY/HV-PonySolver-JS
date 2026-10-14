import { describe, expect, it, vi } from 'vitest'

import { createForwardingStatusSink } from '../../src/host/status-sink'

describe('host status sinks', () => {
  it('forwards model and session stages and keeps inference client-owned', () => {
    const emit = vi.fn()
    const sink = createForwardingStatusSink(emit)

    sink.setStatus({ model: '下载中' })
    sink.setStatus({ session: '初始化中', inference: '推理中' })
    sink.setStatus({ model: '下载中', session: '初始化中', inference: '推理中' })
    sink.setStatus({ inference: '推理中' })
    sink.setStatus({ model: '', session: '' })
    sink.setSessionReady(123)

    expect(emit).toHaveBeenCalledTimes(4)
    expect(emit).toHaveBeenNthCalledWith(1, { model: '下载中' })
    expect(emit).toHaveBeenNthCalledWith(2, { session: '初始化中' })
    expect(emit).toHaveBeenNthCalledWith(3, { model: '下载中', session: '初始化中' })
    expect(emit).toHaveBeenNthCalledWith(4, { session: '已就绪 123ms' })
  })
})
