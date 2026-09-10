type MockWorkerMessage = {
  requestId?: number
  type?: string
  wasmPath?: string
  imageBlob?: Blob
  modelBuffer?: ArrayBuffer
}

function receiveTransferredMessage(message: MockWorkerMessage, transfer: Transferable[] = []): MockWorkerMessage {
  if (message.modelBuffer instanceof ArrayBuffer && transfer.includes(message.modelBuffer)) {
    const workerBytes = new Uint8Array(message.modelBuffer.byteLength)
    workerBytes.set(new Uint8Array(message.modelBuffer))
    structuredClone(message.modelBuffer, { transfer: [message.modelBuffer] })
    return { ...message, modelBuffer: workerBytes.buffer }
  }
  return message
}

function responseFor(messages: MockWorkerMessage[], requestId: number | undefined): object {
  const request = messages.find((message) => message.requestId === requestId)
  if (request?.type === 'detect') {
    return {
      type: 'response',
      requestId,
      result: {
        success: true,
        ponies: ['TS'],
        confidences: { TS: 0.9 },
        detections: [{ class_id: 0, confidence: 0.9 }],
        candidates: [{ class_id: 0, confidence: 0.9 }],
      },
    }
  }
  if (request?.modelBuffer instanceof ArrayBuffer) {
    const callerBytes = new Uint8Array(request.modelBuffer.byteLength)
    callerBytes.set(new Uint8Array(request.modelBuffer))
    return { type: 'response', requestId, modelBuffer: callerBytes.buffer }
  }
  return { type: 'response', requestId }
}

export class FailingWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null

  postMessage(message: { requestId?: number }): void {
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          type: 'error',
          requestId: message.requestId,
          message: 'init failed',
        },
      } as MessageEvent)
    })
  }

  terminate(): void {}
}

export class TimeoutThenSuccessfulWorker {
  static instances: Array<TimeoutThenSuccessfulWorker | SuccessfulWorker> = []
  static messages: MockWorkerMessage[] = []
  static transfers: Transferable[][] = []
  static constructedCount = 0

  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null

  constructor(..._args: unknown[]) {
    TimeoutThenSuccessfulWorker.constructedCount += 1
    if (TimeoutThenSuccessfulWorker.constructedCount > 1) {
      const worker = new SuccessfulWorker()
      TimeoutThenSuccessfulWorker.instances.push(worker)
      return worker
    }
    TimeoutThenSuccessfulWorker.instances.push(this)
  }

  static reset(): void {
    TimeoutThenSuccessfulWorker.instances = []
    TimeoutThenSuccessfulWorker.messages = []
    TimeoutThenSuccessfulWorker.transfers = []
    TimeoutThenSuccessfulWorker.constructedCount = 0
    SuccessfulWorker.reset()
  }

  postMessage(message: MockWorkerMessage, transfer?: Transferable[]): void {
    TimeoutThenSuccessfulWorker.messages.push(receiveTransferredMessage(message, transfer))
    TimeoutThenSuccessfulWorker.transfers.push(transfer ?? [])
  }

  respond(requestId: number | undefined): void {
    this.onmessage?.({
      data: responseFor(TimeoutThenSuccessfulWorker.messages, requestId),
    } as MessageEvent)
  }

  terminate(): void {}
}

export class SuccessfulWorker {
  static messages: MockWorkerMessage[] = []
  static transfers: Transferable[][] = []
  static instances: SuccessfulWorker[] = []
  static terminateCount = 0
  static autoRespond = true

  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null

  constructor() {
    SuccessfulWorker.instances.push(this)
  }

  static reset(): void {
    SuccessfulWorker.messages = []
    SuccessfulWorker.transfers = []
    SuccessfulWorker.instances = []
    SuccessfulWorker.terminateCount = 0
    SuccessfulWorker.autoRespond = true
  }

  postMessage(message: MockWorkerMessage, transfer?: Transferable[]): void {
    SuccessfulWorker.messages.push(receiveTransferredMessage(message, transfer))
    SuccessfulWorker.transfers.push(transfer ?? [])
    if (SuccessfulWorker.autoRespond) {
      queueMicrotask(() => this.respond(message.requestId))
    }
  }

  respond(requestId: number | undefined): void {
    this.onmessage?.({
      data: responseFor(SuccessfulWorker.messages, requestId),
    } as MessageEvent)
  }

  terminate(): void {
    SuccessfulWorker.terminateCount += 1
  }
}
