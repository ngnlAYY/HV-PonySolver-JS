import type { HostStatusUpdate } from '../protocol/messages'

export type ForwardedHostStatus = Readonly<{ model?: string; session?: string }>

/**
 * Single extraction of the Host-owned rows (model/session) that travel across
 * the Host boundary. The broker snapshot merge and the forwarding status sink
 * previously kept two diverging-prone copies of this filter.
 */
export function pickForwardedHostFields(
  changes: HostStatusUpdate | Readonly<Record<string, unknown>>,
): ForwardedHostStatus {
  const status: { model?: string; session?: string } = {}
  if (typeof changes.model === 'string' && changes.model) {
    status.model = changes.model
  }
  if (typeof changes.session === 'string' && changes.session) {
    status.session = changes.session
  }
  return status
}

/**
 * Local copy of the session-ready text rendered by
 * browser-core/src/status-panel/status-panel.ts (StatusPanel.setSessionReady);
 * cross-package duplication is accepted until core exports the formatter.
 */
export function sessionReadyStatus(elapsed: number): ForwardedHostStatus {
  return { session: `已就绪 ${Number(elapsed) || 0}ms` }
}
