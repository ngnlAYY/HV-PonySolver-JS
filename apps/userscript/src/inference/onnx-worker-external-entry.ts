import type * as Ort from 'onnxruntime-web/wasm'

import { loadVerifiedRuntimeAsset } from './verified-runtime-asset-loader'
import { startOnnxWorker } from './onnx-worker-entry'

declare const __HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_URL__: string
declare const __HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_BYTE_LENGTH__: number
declare const __HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_SHA256__: string
declare const __HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_MAX_BYTE_LENGTH__: number
declare const __HV_PONY_SOLVER_EXTERNAL_ORT_MJS_URL__: string
declare const __HV_PONY_SOLVER_EXTERNAL_ORT_MJS_BYTE_LENGTH__: number
declare const __HV_PONY_SOLVER_EXTERNAL_ORT_MJS_SHA256__: string
declare const __HV_PONY_SOLVER_EXTERNAL_ORT_MJS_MAX_BYTE_LENGTH__: number
declare const __HV_PONY_SOLVER_EXTERNAL_ORT_WASM_URL__: string
declare const __HV_PONY_SOLVER_EXTERNAL_ORT_WASM_BYTE_LENGTH__: number
declare const __HV_PONY_SOLVER_EXTERNAL_ORT_WASM_SHA256__: string
declare const __HV_PONY_SOLVER_EXTERNAL_ORT_WASM_MAX_BYTE_LENGTH__: number

const MAX_STARTUP_REQUESTS = 2

type ExternalWorkerScope = typeof globalThis & {
  importScripts(...urls: string[]): void
  ort?: typeof Ort
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  postMessage(message: unknown): void
}

const externalWorkerScope = globalThis as ExternalWorkerScope

function requestIdOf(value: unknown): number | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const requestId = (value as Record<string, unknown>).requestId
  return typeof requestId === 'number' && Number.isSafeInteger(requestId) && requestId > 0 ? requestId : null
}

function rejectStartupRequest(event: MessageEvent<unknown>, message: string): void {
  const requestId = requestIdOf(event.data)
  if (requestId !== null) {
    externalWorkerScope.postMessage({ type: 'error', requestId, message })
  }
}

const startupRequests: MessageEvent<unknown>[] = []
externalWorkerScope.onmessage = (event): void => {
  if (requestIdOf(event.data) === null) {
    return
  }
  if (startupRequests.length >= MAX_STARTUP_REQUESTS) {
    rejectStartupRequest(event, 'ONNX Runtime 启动队列繁忙')
    return
  }
  startupRequests.push(event)
}

const runtimeDownloadController = new AbortController()
void Promise.all([
  loadVerifiedRuntimeAsset(
    'ONNX Runtime 脚本',
    {
      url: __HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_URL__,
      byteLength: __HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_BYTE_LENGTH__,
      sha256: __HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_SHA256__,
      maxByteLength: __HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_MAX_BYTE_LENGTH__,
    },
    undefined,
    runtimeDownloadController.signal,
  ),
  loadVerifiedRuntimeAsset(
    'ONNX Runtime WASM',
    {
      url: __HV_PONY_SOLVER_EXTERNAL_ORT_WASM_URL__,
      byteLength: __HV_PONY_SOLVER_EXTERNAL_ORT_WASM_BYTE_LENGTH__,
      sha256: __HV_PONY_SOLVER_EXTERNAL_ORT_WASM_SHA256__,
      maxByteLength: __HV_PONY_SOLVER_EXTERNAL_ORT_WASM_MAX_BYTE_LENGTH__,
    },
    undefined,
    runtimeDownloadController.signal,
  ),
  loadVerifiedRuntimeAsset(
    'ONNX Runtime JSEP MJS',
    {
      url: __HV_PONY_SOLVER_EXTERNAL_ORT_MJS_URL__,
      byteLength: __HV_PONY_SOLVER_EXTERNAL_ORT_MJS_BYTE_LENGTH__,
      sha256: __HV_PONY_SOLVER_EXTERNAL_ORT_MJS_SHA256__,
      maxByteLength: __HV_PONY_SOLVER_EXTERNAL_ORT_MJS_MAX_BYTE_LENGTH__,
    },
    undefined,
    runtimeDownloadController.signal,
  ),
])
  .then(([scriptBuffer, wasmBuffer, mjsBuffer]) => {
    const mjsUrl = URL.createObjectURL(new Blob([mjsBuffer], { type: 'text/javascript' }))
    let mjsUrlHandedOff = false
    let mjsUrlRevoked = false
    const revokeMjsUrl = (): void => {
      if (mjsUrlRevoked) {
        return
      }
      mjsUrlRevoked = true
      URL.revokeObjectURL(mjsUrl)
    }
    try {
      const scriptUrl = URL.createObjectURL(new Blob([scriptBuffer], { type: 'text/javascript' }))
      try {
        externalWorkerScope.importScripts(scriptUrl)
      } finally {
        URL.revokeObjectURL(scriptUrl)
      }
      const ort = externalWorkerScope.ort
      if (!ort) {
        throw new Error('远程 ONNX Runtime 未注册全局 ort')
      }
      startOnnxWorker(
        ort,
        (runtime) => {
          runtime.env.wasm.numThreads = 1
          runtime.env.wasm.proxy = false
          runtime.env.wasm.wasmPaths = { mjs: mjsUrl }
          runtime.env.wasm.wasmBinary = wasmBuffer
        },
        { onFirstSessionInitSettled: revokeMjsUrl },
      )
      mjsUrlHandedOff = true
      const readyHandler = externalWorkerScope.onmessage
      for (const event of startupRequests.splice(0)) {
        readyHandler?.(event)
      }
    } finally {
      if (!mjsUrlHandedOff) {
        revokeMjsUrl()
      }
    }
  })
  .catch((error: unknown) => {
    runtimeDownloadController.abort(error)
    const message = error instanceof Error ? error.message : String(error)
    const reject = (event: MessageEvent<unknown>): void => rejectStartupRequest(event, message)
    externalWorkerScope.onmessage = reject
    for (const event of startupRequests.splice(0)) {
      reject(event)
    }
  })
