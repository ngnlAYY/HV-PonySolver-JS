import type { InferenceHost } from '../host/inference-host'
import type { HostStatusEmitter } from '../host/status-sink'
import { registerOpenOptionsAction } from '../platform/webextension'
import { registerBroker, type BrokerPolicy } from './broker'

export type InferenceHostFactory = (emitStatus: HostStatusEmitter) => InferenceHost

export function registerFirefoxBackground(
  hostFactory: InferenceHostFactory,
  policy: BrokerPolicy = { allowOptions: true },
): void {
  const host = hostFactory((status) => handle?.broadcastContentStatus(status))
  const handle = registerBroker((request, signal) => host.handle(request, signal), policy)
  registerOpenOptionsAction()
  globalThis.addEventListener('unload', () => host.destroy(), { once: true })
}
