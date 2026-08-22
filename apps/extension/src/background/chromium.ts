import { registerChromiumBackground } from './chromium-bootstrap'
import { scheduleOffscreenIdleReconciliation } from './chromium-offscreen'

// Runs on every service-worker (re)start: a restart that interrupted a
// retention lease would otherwise strand the offscreen document forever.
scheduleOffscreenIdleReconciliation()

registerChromiumBackground()
