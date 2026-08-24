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

  it('reports a CSP-specific failure when Worker construction is blocked by SecurityError', () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new DOMException('Access denied by Content Security Policy', 'SecurityError')
        }
      },
    )

    expect(() => createBlobWorker('')).toThrow('当前页面的内容安全策略（CSP）阻止了 blob: Worker；请让站点放宽 worker-src 后重试')
  })

  it('still revokes the blob URL when Worker construction fails', () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('worker construction failed')
        }
      },
    )

    expect(() => createBlobWorker('')).toThrow('worker construction failed')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-worker')
  })
})
