import { getChromiumOffscreenApi, runtimeGetUrl } from '../platform/webextension'

// Long enough to survive a game-page reload or short navigation so the next
// Port reuses the warm ONNX session instead of rebuilding it.
export const OFFSCREEN_IDLE_TIMEOUT_MS = 30_000

let creatingDocument: Promise<void> | null = null
let closingDocument: Promise<void> | null = null
let idleTimeoutId: ReturnType<typeof setTimeout> | null = null
let activeLeases = 0
let lifecycleRevision = 0

function documentFilter(): Readonly<{ contextTypes: string[]; documentUrls: string[] }> {
  return {
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [runtimeGetUrl('offscreen.html')],
  }
}

export async function ensureOffscreenDocument(): Promise<void> {
  if (closingDocument) {
    await closingDocument
  }
  if (creatingDocument) {
    return creatingDocument
  }
  const operation = (async () => {
    const offscreen = getChromiumOffscreenApi()
    const contexts = await offscreen.getContexts(documentFilter())
    if (contexts.length > 0) {
      return
    }
    await offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Run the packaged ONNX inference worker outside the restartable service worker.',
    })
  })()
  creatingDocument = operation
  try {
    await operation
  } finally {
    if (creatingDocument === operation) {
      creatingDocument = null
    }
  }
}

async function closeOffscreenDocumentIfIdle(revision: number): Promise<void> {
  if (activeLeases !== 0 || revision !== lifecycleRevision || closingDocument) {
    return
  }
  const operation = (async () => {
    try {
      if (creatingDocument) {
        await creatingDocument
      }
      if (activeLeases !== 0 || revision !== lifecycleRevision) {
        return
      }
      const offscreen = getChromiumOffscreenApi()
      const contexts = await offscreen.getContexts(documentFilter())
      if (contexts.length === 0 || activeLeases !== 0 || revision !== lifecycleRevision) {
        return
      }
      await offscreen.closeDocument()
    } catch {
      // Idle cleanup is best-effort; the next lease rechecks the live context.
    }
  })()
  closingDocument = operation
  try {
    await operation
  } finally {
    if (closingDocument === operation) {
      closingDocument = null
    }
  }
}

function scheduleIdleClose(): void {
  if (idleTimeoutId !== null) {
    clearTimeout(idleTimeoutId)
  }
  const revision = ++lifecycleRevision
  idleTimeoutId = setTimeout(() => {
    idleTimeoutId = null
    void closeOffscreenDocumentIfIdle(revision)
  }, OFFSCREEN_IDLE_TIMEOUT_MS)
}

function takeLease(): () => void {
  activeLeases += 1
  lifecycleRevision += 1
  if (idleTimeoutId !== null) {
    clearTimeout(idleTimeoutId)
    idleTimeoutId = null
  }
  let released = false
  return (): void => {
    if (released) {
      return
    }
    released = true
    activeLeases -= 1
    if (activeLeases === 0) {
      scheduleIdleClose()
    }
  }
}

export async function acquireOffscreenDocument(): Promise<() => void> {
  const release = takeLease()
  try {
    await ensureOffscreenDocument()
    return release
  } catch (error) {
    release()
    throw error
  }
}

/**
 * Holds the current offscreen document open without creating one.
 *
 * A connected content Port means the user is on a captcha page and more
 * inference is likely, so keeping the warm ONNX session alive avoids rebuilding
 * it — model read, integrity check, and session construction — per captcha.
 * Unlike {@link acquireOffscreenDocument} this never creates the document, so
 * an idle Port cannot spawn one on its own.
 */
export function retainOffscreenDocument(): () => void {
  return takeLease()
}

/**
 * Reconciles lease state after a service-worker restart.
 *
 * Chromium may terminate the service worker while a retention lease is held,
 * which abandons the in-memory counters and the pending idle-close timer — the
 * offscreen document and its warm ONNX session would then stay resident with
 * nothing left to close them. Scheduling an idle close on every startup fixes
 * that: any real activity takes a lease and cancels the timer, so only a
 * genuinely idle document is closed.
 */
export function scheduleOffscreenIdleReconciliation(): void {
  scheduleIdleClose()
}
