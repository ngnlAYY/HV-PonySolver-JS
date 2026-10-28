import { ModelCache as CoreModelCache, type CacheStatusSink } from '@hv-pony-solver/browser-core'

import { downloadModel } from './model-downloader'

export class ModelCache extends CoreModelCache {
  constructor(statusSink: CacheStatusSink) {
    super(statusSink, downloadModel)
  }
}
