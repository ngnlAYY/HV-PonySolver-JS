import { ORT_RUNTIME_WASM_FILENAME, ORT_RUNTIME_WASM_INTEGRITY } from '@hv-pony-solver/shared'

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function loadPackagedRuntimeWasm(fetchImpl: typeof fetch = fetch): Promise<ArrayBuffer> {
  const url = new URL(`runtime/${ORT_RUNTIME_WASM_FILENAME}`, globalThis.location.href).href
  const response = await fetchImpl(url, { cache: 'force-cache', redirect: 'error' })
  if (!response.ok) {
    throw new Error(`扩展 ONNX Runtime WASM 读取失败: HTTP ${response.status}`)
  }
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null && Number(declaredLength) !== ORT_RUNTIME_WASM_INTEGRITY.byteLength) {
    await response.body?.cancel()
    throw new Error('扩展 ONNX Runtime WASM 大小校验失败')
  }
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength !== ORT_RUNTIME_WASM_INTEGRITY.byteLength) {
    throw new Error('扩展 ONNX Runtime WASM 大小校验失败')
  }
  if ((await sha256Hex(buffer)) !== ORT_RUNTIME_WASM_INTEGRITY.sha256) {
    throw new Error('扩展 ONNX Runtime WASM 完整性校验失败')
  }
  return buffer
}
