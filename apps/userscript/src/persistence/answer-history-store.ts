import { HistoryStore as CoreHistoryStore } from '@hv-pony-solver/browser-core'

import { userscriptHistoryStorage } from '../userscript/gm-storage'

export class HistoryStore extends CoreHistoryStore {
  constructor() {
    super(userscriptHistoryStorage)
  }
}
