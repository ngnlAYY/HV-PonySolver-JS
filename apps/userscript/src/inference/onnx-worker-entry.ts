import { parseYoloOutput } from './yolo-output-parser'

declare const __HV_PONY_SOLVER_WORKER_RUNTIME_SOURCE__: string | undefined

type WorkerGlobal = DedicatedWorkerGlobalScope & {
  ort?: {
    env: { wasm: { wasmPaths?: string, numThreads?: number } }
    Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown
    InferenceSession: {
      create: (modelBuffer: ArrayBuffer, options: { executionProviders: string[] }) => Promise<{ run: (feeds: { images: unknown }) => Promise<Record<string, { data?: Float32Array | { buffer: ArrayBuffer, byteOffset: number, byteLength: number } }>> }>
    }
  }
}

type InitMessage = Readonly<{
  type: 'init'
  requestId?: number
  ortScriptUrl?: string
  wasmPath: string
  modelBuffer: ArrayBuffer
}>

type DetectMessage = Readonly<{
  type: 'detect'
  requestId?: number
  imageBlob: Blob
  size: number
}>

type WorkerRequest = InitMessage | DetectMessage

const workerSelf = self as WorkerGlobal
const runtimeSource = __HV_PONY_SOLVER_WORKER_RUNTIME_SOURCE__
let sessionPromise: ReturnType<NonNullable<WorkerGlobal['ort']>['InferenceSession']['create']> | null = null
let session: Awaited<ReturnType<NonNullable<WorkerGlobal['ort']>['InferenceSession']['create']>> | null = null
let preprocessCanvas: OffscreenCanvas | null = null
let preprocessContext: OffscreenCanvasRenderingContext2D | null = null
let preprocessSize = 0
let preprocessInput: Float32Array | null = null

function loadBundledRuntime(): void {
  if (!runtimeSource) {
    return
  }
  const runtimeLoader = new Function('self', `${runtimeSource}\nif (!self.ort && typeof ort !== 'undefined') self.ort = ort;`)
  runtimeLoader(workerSelf)
}

async function ensureSession(): Promise<Awaited<ReturnType<NonNullable<WorkerGlobal['ort']>['InferenceSession']['create']>>> {
  if (session) {
    return session
  }
  if (!sessionPromise) {
    throw new Error('ONNX Session 未初始化')
  }
  session = await sessionPromise
  return session
}

function ensurePreprocessResources(size: number): OffscreenCanvasRenderingContext2D {
  if (preprocessCanvas && preprocessContext && preprocessSize === size) {
    return preprocessContext
  }
  preprocessCanvas = new OffscreenCanvas(size, size)
  preprocessContext = preprocessCanvas.getContext('2d', { willReadFrequently: true })
  if (!preprocessContext) {
    throw new Error('无法创建 2D canvas 上下文')
  }
  preprocessSize = size
  return preprocessContext
}

async function preprocessImage(imageBlob: Blob, size: number): Promise<Float32Array> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('当前环境不支持 createImageBitmap')
  }
  if (typeof OffscreenCanvas !== 'function') {
    throw new Error('当前环境不支持 OffscreenCanvas')
  }

  const bitmap = await createImageBitmap(imageBlob)
  try {
    const context = ensurePreprocessResources(size)
    context.fillStyle = 'rgb(114, 114, 114)'
    context.fillRect(0, 0, size, size)
    const scale = Math.min(size / bitmap.height, size / bitmap.width)
    const newHeight = Math.max(1, Math.trunc(bitmap.height * scale))
    const newWidth = Math.max(1, Math.trunc(bitmap.width * scale))
    const yOffset = Math.trunc((size - newHeight) / 2)
    const xOffset = Math.trunc((size - newWidth) / 2)
    context.drawImage(bitmap, xOffset, yOffset, newWidth, newHeight)
    const imageData = context.getImageData(0, 0, size, size).data
    const plane = size * size
    if (!preprocessInput || preprocessInput.length !== plane * 3) {
      preprocessInput = new Float32Array(plane * 3)
    }
    const input = preprocessInput
    for (let index = 0, offset = 0; index < plane; index += 1, offset += 4) {
      input[index] = (imageData[offset] ?? 0) / 255
      input[plane + index] = (imageData[offset + 1] ?? 0) / 255
      input[plane * 2 + index] = (imageData[offset + 2] ?? 0) / 255
    }
    return input
  } finally {
    bitmap.close()
  }
}

async function handleInit(message: InitMessage): Promise<{ type: 'response', requestId: number | undefined }> {
  loadBundledRuntime()
  if (!workerSelf.ort) {
    if (!message.ortScriptUrl) {
      throw new Error('onnxruntime-web URL 未配置')
    }
    try {
      importScripts(message.ortScriptUrl)
    } catch (error) {
      throw new Error(`onnxruntime-web 加载失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (!workerSelf.ort) {
    throw new Error('onnxruntime-web 未加载')
  }
  workerSelf.ort.env.wasm.wasmPaths = message.wasmPath
  workerSelf.ort.env.wasm.numThreads = 1
  if (!sessionPromise) {
    sessionPromise = workerSelf.ort.InferenceSession.create(message.modelBuffer, {
      executionProviders: ['wasm'],
    })
  }
  session = await sessionPromise
  return { type: 'response', requestId: message.requestId }
}

async function handleDetect(message: DetectMessage): Promise<{ type: 'response', requestId: number | undefined, result: ReturnType<typeof parseYoloOutput> }> {
  const currentSession = await ensureSession()
  const input = await preprocessImage(message.imageBlob, message.size)
  if (!workerSelf.ort) {
    throw new Error('onnxruntime-web 未加载')
  }
  const tensor = new workerSelf.ort.Tensor('float32', input, [1, 3, message.size, message.size])
  const results = await currentSession.run({ images: tensor })
  const firstOutputKey = Object.keys(results)[0]
  const firstOutput = firstOutputKey ? results[firstOutputKey] : undefined
  if (!firstOutput?.data) {
    throw new Error('ONNX 输出为空')
  }
  const output = firstOutput.data instanceof Float32Array
    ? firstOutput.data
    : new Float32Array(firstOutput.data.buffer, firstOutput.data.byteOffset, firstOutput.data.byteLength / Float32Array.BYTES_PER_ELEMENT)
  return { type: 'response', requestId: message.requestId, result: parseYoloOutput(output) }
}

workerSelf.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data || ({} as WorkerRequest)
  try {
    if (message.type === 'init') {
      workerSelf.postMessage(await handleInit(message))
      return
    }
    if (message.type === 'detect') {
      workerSelf.postMessage(await handleDetect(message))
      return
    }
    throw new Error(`未知消息类型: ${(message as { type?: string }).type}`)
  } catch (error) {
    workerSelf.postMessage({
      type: 'error',
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
