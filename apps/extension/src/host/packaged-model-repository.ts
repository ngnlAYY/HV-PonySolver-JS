import type { ModelRepository } from '@hv-pony-solver/browser-core/inference/onnx-worker-client'

import { loadPackagedModel } from './packaged-model'

export class PackagedModelRepository implements ModelRepository {
  constructor(private readonly loadModel: () => Promise<ArrayBuffer> = loadPackagedModel) {}

  getCached(): Promise<ArrayBuffer> {
    return this.loadModel()
  }

  download(): Promise<never> {
    return Promise.reject(new Error('内置模型不允许远程下载'))
  }

  putCached(): Promise<void> {
    return Promise.resolve()
  }
}
