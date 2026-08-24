import type { ExtensionStorageMirror } from './storage-mirror'
import { MODEL_CREDENTIALS_REVISION_KEY } from '../protocol/model-credentials-revision'

/**
 * The Key lives host-side in IndexedDB, so after its service-worker
 * generation (and with it the Port that carried the live broadcast) dies, the
 * persisted revision change is the only recovery signal a content script can
 * still observe.
 */
export function watchModelCredentialsRevision(storage: ExtensionStorageMirror, onCredentialsChanged: () => void): void {
  storage.addCommittedChangeListener((key, newValue, oldValue) => {
    if (key === MODEL_CREDENTIALS_REVISION_KEY && newValue !== null && newValue !== oldValue) {
      onCredentialsChanged()
    }
  })
}
