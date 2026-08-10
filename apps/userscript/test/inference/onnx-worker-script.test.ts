import { afterEach, describe, expect, it, vi } from 'vitest'

import { createOnnxWorkerScript } from '../../src/inference/onnx-worker-script'

const workerScriptGlobal = '__HV_PONY_SOLVER_TEST_WORKER_SCRIPT__'

describe('createOnnxWorkerScript', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns the build-time worker bundle', () => {
    vi.stubGlobal(workerScriptGlobal, 'self.onmessage = () => {};')
    expect(createOnnxWorkerScript()).toBe('self.onmessage = () => {};')
  })
})
