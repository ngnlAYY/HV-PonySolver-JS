import { createRemoteInferenceHost } from '../host/remote-inference-host'
import { registerOffscreenHost } from './offscreen-bootstrap'

registerOffscreenHost(createRemoteInferenceHost)
