import {
  ModelAccessKeyRejectedError,
  probeModelAccessKey,
  type AppDependencies,
} from '@hv-pony-solver/browser-core'

import { getAnswerMode } from '../captcha/answer-mode-settings'
import { AnswerSubmitter } from '../captcha/answer-submitter'
import { CachedImageLoader } from '../captcha/captcha-image-loader'
import { CaptchaSolver } from '../captcha/captcha-solver'
import { OnnxWorkerClient } from '../inference/onnx-worker-client'
import { ModelCache } from '../model/model-cache'
import { HistoryStore } from '../persistence/answer-history-store'
import { StatusPanel } from '../status-panel/status-panel'
import { registerSettingsMenu } from '../userscript/settings-menu'

export type { AppDependencies }

export function createAppDependencies(getAbortSignal?: () => AbortSignal | undefined): AppDependencies {
  const history = new HistoryStore()
  const panel = new StatusPanel(history)
  const modelCache = new ModelCache(panel)
  const detector = new OnnxWorkerClient(modelCache, panel)
  const imageLoader = new CachedImageLoader()
  const answerSubmitter = new AnswerSubmitter()
  const solver = new CaptchaSolver(panel, detector, imageLoader, answerSubmitter, getAnswerMode, getAbortSignal)
  // A HEAD probe settles Key validity without spending a monthly download:
  // the Worker only meters GET, so verification no longer downloads the model
  // or writes the cache. An invalid Key surfaces through the core rejected-Key
  // copy rendered by the settings menu.
  const verifyModelAccessKey = async (candidateKey: string): Promise<void> => {
    const normalizedKey = candidateKey.trim()
    const probe = await probeModelAccessKey(undefined, { accessKeyOverride: normalizedKey })
    if (!probe.valid) {
      throw new ModelAccessKeyRejectedError()
    }
  }

  return {
    panel,
    detector,
    solver,
    registerSettings: () => registerSettingsMenu({ onVerifyModelAccessKey: verifyModelAccessKey }),
    dispose: () => modelCache.close(),
  }
}
