import type { InferenceHost } from '../host/inference-host'
import type { HostStatusEmitter } from '../host/status-sink'
import { registerOpenOptionsAction } from '../platform/webextension'
import type { HostStatusUpdate } from '../protocol/messages'
import { registerBroker, type BrokerHandle, type BrokerPolicy } from './broker'

export type InferenceHostFactory = (emitStatus: HostStatusEmitter) => InferenceHost

export function registerFirefoxBackground(
  hostFactory: InferenceHostFactory,
  policy: BrokerPolicy = { allowOptions: true },
): void {
  let handle: BrokerHandle | null = null
  const pendingStatuses: HostStatusUpdate[] = []
  const host = hostFactory((status) => {
    if (handle) {
      handle.broadcastContentStatus(status)
      return
    }
    pendingStatuses.push(status)
  })
  handle = registerBroker((request, signal) => host.handle(request, signal), policy)
  for (const status of pendingStatuses) {
    handle.broadcastContentStatus(status)
  }
  registerOpenOptionsAction()
  globalThis.addEventListener('unload', () => host.destroy(), { once: true })
}
