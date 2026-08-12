import {
  ModelCache as CoreModelCache,
  createCachedModelRow,
  readCachedModelBuffer,
  type CacheStatusSink,
} from '@hv-pony-solver/browser-core'

import { downloadModel } from './model-downloader'

export { createCachedModelRow, readCachedModelBuffer }

export class ModelCache extends CoreModelCache {
  constructor(statusSink: CacheStatusSink) {
    super(statusSink, downloadModel)
  }
}
