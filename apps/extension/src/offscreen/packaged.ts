import { createPackagedInferenceHost } from '../host/packaged-inference-host'
import { registerOffscreenHost } from './offscreen-bootstrap'

registerOffscreenHost(createPackagedInferenceHost)
