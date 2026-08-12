import {
  AnswerSubmitter,
  App,
  CachedImageLoader,
  CaptchaSolver,
  HistoryStore,
  StatusPanel,
  getAnswerMode,
  getMultiClickDelayRange,
  getRandomOnFailSync,
  getSubmitDelayRange,
  logError,
} from '@hv-pony-solver/browser-core'

import { RemoteDetectorClient } from './remote-detector-client'
import { startContentRuntime } from './content-runtime'
import { ExtensionStorageMirror } from './storage-mirror'

function createContentApp(storage: ExtensionStorageMirror): App {
  const history = new HistoryStore(storage)
  const panel = new StatusPanel(history, storage)
  const detector = new RemoteDetectorClient(panel)
  const answerSubmitter = new AnswerSubmitter(
    () => getSubmitDelayRange(storage),
    () => getMultiClickDelayRange(storage),
  )
  const appReference: { current: App | null } = { current: null }
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
  return app
}

void startContentRuntime(() => ExtensionStorageMirror.create(), createContentApp).catch((error: unknown) => {
  logError('扩展启动失败:', error instanceof Error ? error.message : String(error))
})
