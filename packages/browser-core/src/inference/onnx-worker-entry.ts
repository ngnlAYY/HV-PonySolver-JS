import type * as Ort from 'onnxruntime-web/wasm'

import {
  assertInferenceImageDimensions,
  calculateLetterboxLayout,
  copyRgbaToChwFloat32,
  validateInferenceImageBeforeDecode,
} from './image-preprocess'
import type { WorkerMessage, WorkerRequest } from './inference-types'
import { parseYoloOutputTensor } from './yolo-output-parser'
import { formatErrorMessage } from '../utils/errors'

const INPUT_SIZE = 640
const INPUT_NAME = 'images'
const OUTPUT_NAME = 'output0'

type WorkerScope = Readonly<{
  postMessage(message: WorkerMessage): void
}> & {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
}

type OnnxRuntime = typeof Ort
type RuntimeInitializer = (runtime: OnnxRuntime) => void | Promise<void>
type WorkerHooks = Readonly<{
  beforeDetect?(): void | Promise<unknown>
}>

class FatalInferenceError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'FatalInferenceError'
  }
}

export function startOnnxWorker(
  runtime: OnnxRuntime,
  initializeRuntime: RuntimeInitializer,
  hooks: WorkerHooks = {},
): void {
  const workerScope = globalThis as unknown as WorkerScope
  let session: Ort.InferenceSession | undefined
  let runtimeInitialization: Promise<void> | undefined

  async function ensureRuntimeInitialized(): Promise<void> {
    runtimeInitialization ??= Promise.resolve(initializeRuntime(runtime))
    return runtimeInitialization
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
      const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) {
        throw new Error('无法创建验证码画布')
      }
      context.fillStyle = '#727272'
      context.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE)
      const layout = calculateLetterboxLayout(bitmap.width, bitmap.height, INPUT_SIZE)
      context.drawImage(bitmap, layout.x, layout.y, layout.width, layout.height)
      const rgba = context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data
      const plane = INPUT_SIZE * INPUT_SIZE
      const data = new Float32Array(plane * 3)
      copyRgbaToChwFloat32(rgba, data, plane)
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
    await ensureRuntimeInitialized()
    await releaseSession()
    session = await runtime.InferenceSession.create(modelBuffer, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'disabled',
    })
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

  workerScope.onmessage = (event): void => {
    const request = event.data
    void (async () => {
      try {
        if (request.type === 'init') {
          await initializeSession(request.modelBuffer)
          workerScope.postMessage({ type: 'response', requestId: request.requestId })
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
          ...(error instanceof FatalInferenceError ? { fatal: true } : {}),
        })
      }
    })()
  }
}
