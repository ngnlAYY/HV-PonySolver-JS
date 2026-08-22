import type { ModelRepository } from '@hv-pony-solver/browser-core/inference/onnx-worker-client'

import { loadPackagedModel } from './packaged-model'

export class PackagedModelRepository implements ModelRepository {
  constructor(
    private readonly loadModel: (signal?: AbortSignal) => Promise<ArrayBuffer> = (signal) =>
      loadPackagedModel(fetch, signal),
  ) {}

  getCached(signal?: AbortSignal): Promise<ArrayBuffer> {
    return this.loadModel(signal)
  }

  download(): Promise<never> {
    return Promise.reject(new Error('内置模型不允许远程下载'))
  }

  putCached(): Promise<void> {
    return Promise.resolve()
  }
}
