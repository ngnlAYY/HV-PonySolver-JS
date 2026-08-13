import type * as Ort from 'onnxruntime-web/wasm'

import { calculateLetterboxLayout, copyRgbaToChwFloat32 } from './image-preprocess'
import { parseYoloOutput } from './yolo-output-parser'
import { formatErrorMessage } from '../utils/errors'

const INPUT_SIZE = 640
const INPUT_NAME = 'images'
const OUTPUT_NAME = 'output0'

type InitRequest = Readonly<{ type: 'init'; requestId: number; modelBuffer: ArrayBuffer }>
type DetectRequest = Readonly<{ type: 'detect'; requestId: number; imageBlob: Blob }>
type WorkerRequest = InitRequest | DetectRequest
type WorkerResponse =
  | Readonly<{ type: 'response'; requestId: number; result?: ReturnType<typeof parseYoloOutput> }>
  | Readonly<{ type: 'error'; requestId: number; message: string }>

type WorkerScope = Readonly<{
  postMessage(message: WorkerResponse): void
}> & {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
}

type OnnxRuntime = typeof Ort
type RuntimeInitializer = (runtime: OnnxRuntime) => void | Promise<void>

export function startOnnxWorker(runtime: OnnxRuntime, initializeRuntime: RuntimeInitializer): void {
  const workerScope = globalThis as unknown as WorkerScope
  let session: Ort.InferenceSession | undefined
  let runtimeInitialization: Promise<void> | undefined

  async function ensureRuntimeInitialized(): Promise<void> {
    runtimeInitialization ??= Promise.resolve(initializeRuntime(runtime))
    return runtimeInitialization
  }

  async function createInputTensor(imageBlob: Blob): Promise<Ort.Tensor> {
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(imageBlob)
    } catch (error) {
      throw new Error(`验证码图片解码失败: ${formatErrorMessage(error)}`, { cause: error })
    }
    try {
      if (bitmap.width < 1 || bitmap.height < 1) {
        throw new Error('验证码图片尺寸无效')
      }
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

  async function initializeSession(modelBuffer: ArrayBuffer): Promise<void> {
    await ensureRuntimeInitialized()
    await session?.release()
    session = await runtime.InferenceSession.create(modelBuffer, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'disabled',
    })
  }

  async function detect(imageBlob: Blob): Promise<ReturnType<typeof parseYoloOutput>> {
    if (!session) {
      throw new Error('ONNX Worker 尚未初始化')
    }
    const input = await createInputTensor(imageBlob)
    let outputs: Awaited<ReturnType<Ort.InferenceSession['run']>>
    try {
      outputs = await session.run({ [INPUT_NAME]: input })
    } catch (error) {
      throw new Error(`ONNX 推理执行失败: ${formatErrorMessage(error)}`, { cause: error })
    }
    const output = outputs[OUTPUT_NAME]
    if (!output || !(output.data instanceof Float32Array)) {
      throw new Error('模型输出格式无效')
    }
    return parseYoloOutput(output.data)
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
        const result = await detect(request.imageBlob)
        workerScope.postMessage({ type: 'response', requestId: request.requestId, result })
      } catch (error) {
        workerScope.postMessage({
          type: 'error',
          requestId: request.requestId,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    })()
  }
}
