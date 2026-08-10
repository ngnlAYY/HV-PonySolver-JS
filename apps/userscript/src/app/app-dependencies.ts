import { getAnswerMode } from '../captcha/answer-mode-settings'
import { AnswerSubmitter } from '../captcha/answer-submitter'
import { CachedImageLoader } from '../captcha/captcha-image-loader'
import { CaptchaSolver } from '../captcha/captcha-solver'
import { OnnxWorkerClient } from '../inference/onnx-worker-client'
import { ModelCache } from '../model/model-cache'
import { HistoryStore } from '../persistence/answer-history-store'
import { StatusPanel } from '../status-panel/status-panel'

export type AppDependencies = Readonly<{
  panel: StatusPanel
  modelCache: ModelCache
  detector: OnnxWorkerClient
  solver: CaptchaSolver
}>

export function createAppDependencies(getAbortSignal?: () => AbortSignal | undefined): AppDependencies {
  const history = new HistoryStore()
  const panel = new StatusPanel(history)
  const modelCache = new ModelCache(panel)
  const detector = new OnnxWorkerClient(modelCache, panel)
  const imageLoader = new CachedImageLoader()
  const answerSubmitter = new AnswerSubmitter()
  const solver = new CaptchaSolver(panel, detector, imageLoader, answerSubmitter, getAnswerMode, getAbortSignal)

  return {
    panel,
    modelCache,
    detector,
    solver,
  }
}
