import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

import { createOnnxWorkerScript } from '../../src/inference/onnx-worker-script'

describe('createOnnxWorkerScript', () => {
  it('loads onnxruntime-web from ortScriptUrl by default', () => {
    const script = createOnnxWorkerScript()

    expect(script).toContain('importScripts(message.ortScriptUrl)')
    expect(script).toContain('onnxruntime-web 加载失败')
  })

  it('exposes a bundled ort global when runtime source declares var ort', () => {
    const runtimeSource = 'var ort = { env: { wasm: {} }, marker: "bundled" };'

    const script = createOnnxWorkerScript(runtimeSource)
    const context = {
      self: {
        postMessage: () => undefined,
      },
    }

    vm.runInNewContext(script, context)

    expect(context.self).toMatchObject({
      ort: {
        marker: 'bundled',
      },
    })
    expect(script).not.toContain('importScripts')
    expect(script).not.toContain('ortScriptUrl')
  })
})
