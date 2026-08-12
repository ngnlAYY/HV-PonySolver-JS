import { registerBroker } from './broker'
import { createInferenceHost } from '../host/inference-host'
import { registerOpenOptionsAction } from '../platform/webextension'

const host = createInferenceHost()

registerBroker((request) => host.handle(request))
registerOpenOptionsAction()
globalThis.addEventListener('unload', () => host.destroy(), { once: true })
