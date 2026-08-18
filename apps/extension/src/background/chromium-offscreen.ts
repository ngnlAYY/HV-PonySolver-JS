import { getChromiumOffscreenApi, runtimeGetUrl } from '../platform/webextension'

export const OFFSCREEN_IDLE_TIMEOUT_MS = 5_000

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

export async function acquireOffscreenDocument(): Promise<() => void> {
  activeLeases += 1
  lifecycleRevision += 1
  if (idleTimeoutId !== null) {
    clearTimeout(idleTimeoutId)
    idleTimeoutId = null
  }
  let released = false
  const release = (): void => {
    if (released) {
      return
    }
    released = true
    activeLeases -= 1
    if (activeLeases === 0) {
      scheduleIdleClose()
    }
  }
  try {
    await ensureOffscreenDocument()
    return release
  } catch (error) {
    release()
    throw error
  }
}
