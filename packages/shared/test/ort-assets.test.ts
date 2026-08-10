import { describe, expect, it } from 'vitest'

import {
  ORT_MODEL_INTEGRITY,
  ORT_MODEL_OBJECT_KEY,
  ORT_MODEL_PUBLIC_PATH,
  ORT_MODEL_URL,
  ORT_RUNTIME_WASM_FILENAME,
  ORT_RUNTIME_WASM_INTEGRITY,
  ORT_RUNTIME_WASM_OBJECT_KEY,
  ORT_RUNTIME_WASM_PUBLIC_PATH,
  ORT_RUNTIME_WASM_URL,
} from '../src/ort-assets'

describe('ORT asset contract', () => {
  it('keeps the new model separate from the legacy ONNX path', () => {
    expect(ORT_MODEL_PUBLIC_PATH).toBe('/yolo26n-640.ort')
    expect(ORT_MODEL_URL).toBe('https://models.ngnl.host/yolo26n-640.ort')
    expect(ORT_MODEL_OBJECT_KEY).toBe('real/yolo26n-640.ort')
    expect(ORT_MODEL_INTEGRITY).toEqual({
      byteLength: 9_914_448,
      sha256: '4e771776d9356679539ffed53ee40ea012394f9b586aa92a76267e8fee38094c',
    })
  })

  it('uses an exact content-addressed first-party WASM URL and object key', () => {
    expect(ORT_RUNTIME_WASM_FILENAME).toContain(ORT_RUNTIME_WASM_INTEGRITY.sha256)
    expect(ORT_RUNTIME_WASM_PUBLIC_PATH).toBe(`/runtime/${ORT_RUNTIME_WASM_FILENAME}`)
    expect(ORT_RUNTIME_WASM_OBJECT_KEY).toBe(`runtime/${ORT_RUNTIME_WASM_FILENAME}`)
    expect(ORT_RUNTIME_WASM_URL).toBe(`https://models.ngnl.host${ORT_RUNTIME_WASM_PUBLIC_PATH}`)
    expect(ORT_RUNTIME_WASM_INTEGRITY.byteLength).toBe(1_267_937)
  })
})
