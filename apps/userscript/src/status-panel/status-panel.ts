import { StatusPanel as CoreStatusPanel } from '@hv-pony-solver/browser-core'

import type { HistoryStore } from '../persistence/answer-history-store'
import { gmSettingsStorage } from '../userscript/gm-storage'

export class StatusPanel extends CoreStatusPanel {
  constructor(history: HistoryStore) {
    super(history, gmSettingsStorage)
  }
}
