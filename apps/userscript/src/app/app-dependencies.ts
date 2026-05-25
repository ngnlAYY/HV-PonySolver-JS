import { AnswerSubmitter } from '../captcha/answer-submitter'
import { CachedImageLoader } from '../captcha/captcha-image-loader'
import { CaptchaSolver } from '../captcha/captcha-solver'
import { OnnxWorkerClient } from '../inference/onnx-worker-client'
import { getBundledOnnxRuntimeSource } from '../inference/onnx-runtime-source'
import { ModelCache } from '../model/model-cache'
import { HistoryStore } from '../persistence/answer-history-store'
import { StatusPanel } from '../status-panel/status-panel'

export type AppDependencies = Readonly<{
  panel: StatusPanel
  modelCache: ModelCache
  detector: OnnxWorkerClient
  solver: CaptchaSolver
}>

export function createAppDependencies(): AppDependencies {
  const history = new HistoryStore()
  const panel = new StatusPanel(history)
  const modelCache = new ModelCache(panel)
  const bundledRuntimeSource = getBundledOnnxRuntimeSource()
  const detector = new OnnxWorkerClient(modelCache, panel, bundledRuntimeSource ? { bundledRuntimeSource } : {})
  const imageLoader = new CachedImageLoader()
  const answerSubmitter = new AnswerSubmitter()
  const solver = new CaptchaSolver(panel, detector, imageLoader, answerSubmitter)

  return {
    panel,
    modelCache,
    detector,
    solver,
  }
}
