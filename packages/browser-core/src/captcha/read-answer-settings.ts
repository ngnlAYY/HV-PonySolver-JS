import { inferenceTimeoutConfig } from '../inference/inference-config'
import { raceAbort } from '../utils/abort-race'

/** GM 读取不能撤销；取消或超时后释放本轮，丢弃底层读取的迟到结果。 */
export async function readAnswerSettings<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw signal.reason ?? new DOMException('操作已取消', 'AbortError')
  const timeoutController = new AbortController()
  const timeout = setTimeout(
    () => timeoutController.abort(new Error('读取答题设置超时')),
    inferenceTimeoutConfig.settingsReadTimeoutMs,
  )
  try {
    return await raceAbort(read(), signal ? [signal, timeoutController.signal] : timeoutController.signal)
  } finally {
    clearTimeout(timeout)
  }
}
