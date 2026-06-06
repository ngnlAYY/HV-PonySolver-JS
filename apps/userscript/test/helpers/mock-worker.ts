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
  static messages: Array<{ requestId?: number; type?: string; ortScriptUrl?: string; wasmPath?: string; imageBlob?: Blob }> = []
  static transfers: Transferable[][] = []
  static constructedCount = 0

  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null

  constructor(...args: unknown[]) {
    TimeoutThenSuccessfulWorker.constructedCount += 1
    if (TimeoutThenSuccessfulWorker.constructedCount > 1) {
      const worker = new SuccessfulWorker(...args)
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

  postMessage(message: { requestId?: number; type?: string; ortScriptUrl?: string; wasmPath?: string; imageBlob?: Blob }, transfer?: Transferable[]): void {
    TimeoutThenSuccessfulWorker.messages.push(message)
    TimeoutThenSuccessfulWorker.transfers.push(transfer ?? [])
    for (const item of transfer ?? []) {
      if (item instanceof ArrayBuffer) {
        structuredClone(item, { transfer: [item] })
      }
    }
  }

  respond(requestId: number | undefined): void {
    const response = TimeoutThenSuccessfulWorker.messages.find((message) => message.requestId === requestId)?.type === 'detect'
      ? { type: 'response', requestId, result: { success: true, ponies: ['TS'], confidences: { TS: 0.9 }, detections: [{ class_id: 0, confidence: 0.9 }], candidates: [{ class_id: 0, confidence: 0.9 }] } }
      : { type: 'response', requestId }
    this.onmessage?.({
      data: response,
    } as MessageEvent)
  }

  terminate(): void {}
}

export class SuccessfulWorker {
  static messages: Array<{ requestId?: number; type?: string; ortScriptUrl?: string; wasmPath?: string; imageBlob?: Blob }> = []
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

  postMessage(message: { requestId?: number; type?: string; ortScriptUrl?: string; wasmPath?: string; imageBlob?: Blob }, transfer?: Transferable[]): void {
    SuccessfulWorker.messages.push(message)
    SuccessfulWorker.transfers.push(transfer ?? [])
    for (const item of transfer ?? []) {
      if (item instanceof ArrayBuffer) {
        structuredClone(item, { transfer: [item] })
      }
    }
    if (SuccessfulWorker.autoRespond) {
      queueMicrotask(() => this.respond(message.requestId))
    }
  }

  respond(requestId: number | undefined): void {
    const response = SuccessfulWorker.messages.find((message) => message.requestId === requestId)?.type === 'detect'
      ? { type: 'response', requestId, result: { success: true, ponies: ['TS'], confidences: { TS: 0.9 }, detections: [{ class_id: 0, confidence: 0.9 }], candidates: [{ class_id: 0, confidence: 0.9 }] } }
      : { type: 'response', requestId }
    this.onmessage?.({
      data: response,
    } as MessageEvent)
  }

  terminate(): void {
    SuccessfulWorker.terminateCount += 1
  }
}
