import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlobWorker } from '../../src/inference/blob-worker'

class TestWorker {
  constructor(readonly url: string) {}
}

describe('createBlobWorker', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('Worker', TestWorker)
    vi.stubGlobal('Blob', Blob)
    URL.createObjectURL = vi.fn(() => 'blob:test-worker')
    URL.revokeObjectURL = vi.fn()
  })

  it('creates a worker from script text and revokes the blob URL', () => {
    const worker = createBlobWorker('self.onmessage = () => {}')

    expect(worker).toBeInstanceOf(TestWorker)
    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-worker')
  })

  it('throws when Worker is unavailable', () => {
    vi.stubGlobal('Worker', undefined)

    expect(() => createBlobWorker('')).toThrow('当前环境不支持 Web Worker')
  })
})
