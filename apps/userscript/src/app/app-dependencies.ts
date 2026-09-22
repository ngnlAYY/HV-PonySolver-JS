import { ModelAccessKeyRejectedError, probeModelAccessKey, type AppDependencies } from '@hv-pony-solver/browser-core'

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

export function createAppDependencies(
  getAbortSignal?: () => AbortSignal | undefined,
  recoverAfterModelCredentialsChanged?: () => void,
): AppDependencies {
  let disposed = false
  let credentialsRevision = 0
  const history = new HistoryStore()
  const panel = new StatusPanel(history)
  const modelCache = new ModelCache(panel)
  const detector = new OnnxWorkerClient(modelCache, panel)
  const imageLoader = new CachedImageLoader()
  const answerSubmitter = new AnswerSubmitter()
  const solver = new CaptchaSolver(panel, detector, imageLoader, answerSubmitter, getAnswerMode, getAbortSignal)
  const onModelAccessKeyCommitted = async (): Promise<void> => {
    if (disposed) return
    const revision = ++credentialsRevision
    // GM 写入已成功；先结算旧 Key 的初始化，再允许当前目标重新准备。
    // 已就绪会话不依赖 Key，取消接口会保留它供后续验证码复用。
    await detector.cancelPendingPreparation()
    if (!disposed && revision === credentialsRevision) recoverAfterModelCredentialsChanged?.()
  }
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
    registerSettings: () =>
      registerSettingsMenu({ onVerifyModelAccessKey: verifyModelAccessKey, onModelAccessKeyCommitted }),
    dispose: () => {
      disposed = true
      modelCache.close()
    },
  }
}
