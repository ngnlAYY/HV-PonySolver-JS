import type { AnswerCode } from '@hv-pony-solver/shared/answer'

export type PanelStatus = Readonly<{
  model: string
  session: string
  inference: string
}>

export interface CacheStatusSink {
  setStatus(changes: Pick<Partial<PanelStatus>, 'model'>): void
}

export interface InferenceStatusSink {
  setStatus(changes: Partial<PanelStatus>): void
  setSessionReady(elapsed: number): void
}

export interface StatusPanel extends InferenceStatusSink {
  setStatus(changes: Partial<PanelStatus>): void
  setSessionReady(elapsed: number): void
  addSuccess(ponies: AnswerCode[], confidences: Partial<Record<AnswerCode, number>>, elapsed: number): void
  addManualResult(ponies: AnswerCode[], confidences: Partial<Record<AnswerCode, number>>, elapsed: number): void
  addRandomFailure(pony: AnswerCode, elapsed: number): void
  addError(message: string, elapsed?: number): void
  create(): void
  destroy(): void
}
