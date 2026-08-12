import type { DetectorService } from '../inference/inference-types'
import type { StatusPanel } from '../status-panel/status-panel-types'
import type { SolveResult } from '../captcha/captcha-solver'

export interface SolverService {
  readonly isBusy: boolean
  trigger(): Promise<SolveResult>
}

export type AppDependencies = Readonly<{
  panel: StatusPanel
  detector: DetectorService
  solver: SolverService
  registerSettings?: () => void
  dispose?: () => void
}>
