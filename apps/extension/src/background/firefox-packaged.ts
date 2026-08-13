import { createPackagedInferenceHost } from '../host/packaged-inference-host'
import { registerFirefoxBackground } from './firefox-bootstrap'

registerFirefoxBackground(createPackagedInferenceHost, { allowOptions: false })
