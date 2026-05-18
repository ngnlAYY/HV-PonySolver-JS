import type { AnswerCode } from '@hv-pony-solver/shared'

export type PanelStatus = Readonly<{
  model: string
  session: string
  inference: string
}>

export interface StatusPanel {
  setStatus(changes: Partial<PanelStatus>): void
  setSessionReady(elapsed: number): void
  addSuccess(ponies: AnswerCode[], confidences: Partial<Record<AnswerCode, number>>, elapsed: number): void
  addRandomFailure(pony: AnswerCode, elapsed: number): void
  addError(message: string, elapsed?: number): void
  create(): void
  destroy(): void
}
