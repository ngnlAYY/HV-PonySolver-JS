import { getChromiumOffscreenApi, runtimeGetUrl } from '../platform/webextension'

let creatingDocument: Promise<void> | null = null
let closingDocument: Promise<void> | null = null
let pendingAdmissions = 0

function documentFilter(): Readonly<{ contextTypes: string[]; documentUrls: string[] }> {
  return {
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [runtimeGetUrl('offscreen.html')],
  }
}

export async function hasOffscreenDocument(): Promise<boolean> {
  if (closingDocument) {
    await closingDocument
  }
  if (creatingDocument) {
    await creatingDocument
  }
  const contexts = await getChromiumOffscreenApi().getContexts(documentFilter())
  return contexts.length > 0
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

export async function acquireOffscreenAdmission(): Promise<() => void> {
  pendingAdmissions += 1
  let released = false
  const release = (): void => {
    if (released) {
      return
    }
    released = true
    pendingAdmissions -= 1
  }
  try {
    await ensureOffscreenDocument()
    return release
  } catch (error) {
    release()
    throw error
  }
}

export async function closeOffscreenDocumentIfIdle(confirmIdle: () => Promise<boolean>): Promise<void> {
  if (pendingAdmissions !== 0 || closingDocument) {
    return
  }
  const operation = (async () => {
    try {
      if (creatingDocument) {
        await creatingDocument
      }
      if (pendingAdmissions !== 0 || !(await confirmIdle()) || pendingAdmissions !== 0) {
        return
      }
      const offscreen = getChromiumOffscreenApi()
      const contexts = await offscreen.getContexts(documentFilter())
      if (contexts.length === 0 || pendingAdmissions !== 0) {
        return
      }
      await offscreen.closeDocument()
    } catch {
      // Offscreen repeats the authoritative idle notification while it remains alive.
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
