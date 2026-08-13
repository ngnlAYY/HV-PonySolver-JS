import { registerBroker } from './broker'
import { createPackagedInferenceHost } from '../host/packaged-inference-host'
import { registerOpenOptionsAction } from '../platform/webextension'

const host = createPackagedInferenceHost()

registerBroker((request) => host.handle(request), { allowOptions: false })
registerOpenOptionsAction()
globalThis.addEventListener('unload', () => host.destroy(), { once: true })
