import { App } from '@hv-pony-solver/browser-core/app/app'
import { getAnswerMode } from '@hv-pony-solver/browser-core/captcha/answer-mode-settings'
import { getPreserveCheckedAnswersSync } from '@hv-pony-solver/browser-core/captcha/answer-selection-settings'
import { AnswerSubmitter } from '@hv-pony-solver/browser-core/captcha/answer-submitter'
import { CachedImageLoader } from '@hv-pony-solver/browser-core/captcha/captcha-image-loader'
import { CaptchaSolver } from '@hv-pony-solver/browser-core/captcha/captcha-solver'
import { getRandomOnFailSync } from '@hv-pony-solver/browser-core/captcha/fallback-settings'
import { getMultiClickDelayRange, getSubmitDelayRange } from '@hv-pony-solver/browser-core/captcha/timing-settings'
import { HistoryStore } from '@hv-pony-solver/browser-core/persistence/answer-history-store'
import { StatusPanel } from '@hv-pony-solver/browser-core/status-panel/status-panel'
import { logError } from '@hv-pony-solver/browser-core/utils/logger'

import { RemoteDetectorClient } from './remote-detector-client'
import { watchModelCredentialsRevision } from './credentials-watch'
import { startContentRuntime } from './content-runtime'
import { scheduleExperiencedPrefetch } from './prefetch'
import { ExtensionStorageMirror } from './storage-mirror'

function createContentApp(storage: ExtensionStorageMirror): App {
  const history = new HistoryStore(storage)
  const panel = new StatusPanel(history, storage)
  const appReference: { current: App | null } = { current: null }
  const detector = new RemoteDetectorClient(panel, () => appReference.current?.recoverAfterModelCredentialsChanged())
  const answerSubmitter = new AnswerSubmitter(
    () => getSubmitDelayRange(storage),
    () => getMultiClickDelayRange(storage),
    () => getPreserveCheckedAnswersSync(storage),
  )
  const solver = new CaptchaSolver(
    panel,
    detector,
    new CachedImageLoader(),
    answerSubmitter,
    () => getAnswerMode(storage),
    () => appReference.current?.getAbortSignal(),
    getRandomOnFailSync(storage),
  )
  const app = new App({
    panel,
    detector,
    solver,
    dispose: () => storage.destroy(),
  })
  appReference.current = app
  watchModelCredentialsRevision(storage, () => appReference.current?.recoverAfterModelCredentialsChanged())
  scheduleExperiencedPrefetch(history, detector, () => appReference.current?.getAbortSignal())
  return app
}

void startContentRuntime(() => ExtensionStorageMirror.create(), createContentApp).catch((error: unknown) => {
  logError('扩展启动失败:', error instanceof Error ? error.message : String(error))
})
