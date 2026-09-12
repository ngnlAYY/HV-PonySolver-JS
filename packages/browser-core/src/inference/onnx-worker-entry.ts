import { isPermanentModelError } from '../model/permanent-model-error'
import type * as Ort from 'onnxruntime-web/wasm'

import {
  assertInferenceImageDimensions,
  calculateLetterboxLayout,
  copyRgbaToChwFloat32,
  validateInferenceImageBeforeDecode,
} from './image-preprocess'
import { imagePreprocessConfig } from './inference-config'
import type { WorkerMessage, WorkerRequest } from './inference-types'
import { parseYoloOutputTensor } from './yolo-output-parser'
import { formatErrorMessage } from '../utils/errors'
import { isRecordObject } from '../utils/guards'

const INPUT_SIZE = imagePreprocessConfig.imageSize
const INPUT_NAME = 'images'
const OUTPUT_NAME = 'output0'

type WorkerScope = Readonly<{
  postMessage(message: WorkerMessage, transfer?: Transferable[]): void
}> & {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
}

type OnnxRuntime = typeof Ort
type RuntimeInitializer = (runtime: OnnxRuntime) => void | Promise<void>
type WorkerHooks = Readonly<{
  beforeDetect?(): void | Promise<unknown>
  onFirstSessionInitSettled?(): void | Promise<unknown>
}>

class FatalInferenceError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'FatalInferenceError'
  }
}

function isSafeRequestId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && keys.every((key) => expected.includes(key))
}

function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (!isRecordObject(value) || !isSafeRequestId(value.requestId)) {
    return false
  }
  if (value.type === 'init') {
    return hasExactKeys(value, ['type', 'requestId', 'modelBuffer']) && value.modelBuffer instanceof ArrayBuffer
  }
  return (
    value.type === 'detect' &&
    hasExactKeys(value, ['type', 'requestId', 'imageBlob']) &&
    value.imageBlob instanceof Blob
  )
}

export function startOnnxWorker(
  runtime: OnnxRuntime,
  initializeRuntime: RuntimeInitializer,
  hooks: WorkerHooks = {},
): void {
  // SAFETY: This module is only loaded in a dedicated worker, whose global
  // scope implements WorkerScope even though TypeScript cannot express that
  // relationship for globalThis.
  const workerScope = globalThis as unknown as WorkerScope
  let session: Ort.InferenceSession | undefined
  let runtimeInitialization: Promise<void> | undefined
  let firstSessionInitStarted = false
  let requestTail: Promise<void> = Promise.resolve()
  // Detect requests are processed serially, so the canvas, its context, and
  // the CHW output buffer are allocated once per worker and reused per frame.
  // The RGBA readback itself is the one allocation getImageData cannot avoid.
  let inputContext: OffscreenCanvasRenderingContext2D | null = null
  let chwFloat32: Float32Array | null = null

  async function ensureRuntimeInitialized(): Promise<void> {
    runtimeInitialization ??= Promise.resolve(initializeRuntime(runtime))
    return runtimeInitialization
  }

  function prepareReusableInputFrame(): { context: OffscreenCanvasRenderingContext2D; data: Float32Array } {
    if (!inputContext || !chwFloat32) {
      const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) {
        throw new Error('无法创建验证码画布')
      }
      inputContext = context
      chwFloat32 = new Float32Array(INPUT_SIZE * INPUT_SIZE * 3)
    }
    return { context: inputContext, data: chwFloat32 }
  }

  async function createInputTensor(imageBlob: Blob): Promise<Ort.Tensor> {
    await validateInferenceImageBeforeDecode(imageBlob)
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(imageBlob)
    } catch (error) {
      throw new Error(`验证码图片解码失败: ${formatErrorMessage(error)}`, { cause: error })
    }
    try {
      // This fallback protects formats whose dimensions cannot be read from the
      // encoded header; preflight checks already ran for PNG/GIF/JPEG/WebP.
      assertInferenceImageDimensions(bitmap.width, bitmap.height)
      const { context, data } = prepareReusableInputFrame()
      context.fillStyle = '#727272'
      context.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE)
      const layout = calculateLetterboxLayout(bitmap.width, bitmap.height, INPUT_SIZE)
      context.drawImage(bitmap, layout.x, layout.y, layout.width, layout.height)
      const rgba = context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data
      copyRgbaToChwFloat32(rgba, data, INPUT_SIZE * INPUT_SIZE)
      return new runtime.Tensor('float32', data, [1, 3, INPUT_SIZE, INPUT_SIZE])
    } finally {
      bitmap.close()
    }
  }

  async function releaseSession(target: Ort.InferenceSession | undefined = session): Promise<void> {
    if (session === target) {
      session = undefined
    }
    if (!target) {
      return
    }
    try {
      await target.release()
    } catch {
      // A failed session is already unusable; preserve the primary inference error.
    }
  }

  async function initializeSession(modelBuffer: ArrayBuffer): Promise<void> {
    const isFirstSessionInit = !firstSessionInitStarted
    firstSessionInitStarted = true
    try {
      await ensureRuntimeInitialized()
      await releaseSession()
      session = await runtime.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'disabled',
      })
    } finally {
      if (isFirstSessionInit) {
        await hooks.onFirstSessionInitSettled?.()
      }
    }
  }

  async function detect(imageBlob: Blob): Promise<ReturnType<typeof parseYoloOutputTensor>> {
    const activeSession = session
    if (!activeSession) {
      throw new FatalInferenceError('ONNX Worker 尚未初始化')
    }
    const input = await createInputTensor(imageBlob)
    let outputs: Awaited<ReturnType<Ort.InferenceSession['run']>>
    try {
      outputs = await activeSession.run({ [INPUT_NAME]: input })
    } catch (error) {
      await releaseSession(activeSession)
      throw new FatalInferenceError(`ONNX 推理执行失败: ${formatErrorMessage(error)}`, error)
    }
    const output = outputs[OUTPUT_NAME]
    try {
      if (!output) {
        throw new Error('缺少 output0')
      }
      return parseYoloOutputTensor(output)
    } catch (error) {
      await releaseSession(activeSession)
      throw new FatalInferenceError(`模型输出格式无效: ${formatErrorMessage(error)}`, error)
    }
  }

  async function processRequest(request: WorkerRequest): Promise<void> {
    try {
      if (request.type === 'init') {
        await initializeSession(request.modelBuffer)
        workerScope.postMessage({ type: 'response', requestId: request.requestId, modelBuffer: request.modelBuffer }, [
          request.modelBuffer,
        ])
        return
      }
      await hooks.beforeDetect?.()
      const result = await detect(request.imageBlob)
      workerScope.postMessage({ type: 'response', requestId: request.requestId, result })
    } catch (error) {
      workerScope.postMessage({
        type: 'error',
        requestId: request.requestId,
        message: error instanceof Error ? error.message : String(error),
        ...(isPermanentModelError(error) ? { errorKind: 'permanent-model' as const } : {}),
        ...(error instanceof FatalInferenceError ? { fatal: true } : {}),
      })
    }
  }

  workerScope.onmessage = (event): void => {
    const request = event.data
    if (!isWorkerRequest(request)) {
      const requestId = isRecordObject(request) && isSafeRequestId(request.requestId) ? request.requestId : null
      if (requestId !== null) {
        workerScope.postMessage({ type: 'error', requestId, message: 'ONNX Worker 请求格式无效' })
      }
      return
    }
    const run = (): Promise<void> => processRequest(request)
    requestTail = requestTail.then(run, run)
  }
}
