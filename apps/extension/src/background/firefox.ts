import { createRemoteInferenceHost } from '../host/remote-inference-host'
import { registerFirefoxBackground } from './firefox-bootstrap'

registerFirefoxBackground(createRemoteInferenceHost)
