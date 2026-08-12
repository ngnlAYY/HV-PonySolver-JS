import { getChromiumOffscreenApi, runtimeGetUrl } from '../platform/webextension'

let creatingDocument: Promise<void> | null = null

export async function ensureOffscreenDocument(): Promise<void> {
  if (creatingDocument) {
    return creatingDocument
  }
  creatingDocument = (async () => {
    const documentUrl = runtimeGetUrl('offscreen.html')
    const offscreen = getChromiumOffscreenApi()
    const contexts = await offscreen.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [documentUrl],
    })
    if (contexts.length > 0) {
      return
    }
    await offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Run the packaged ONNX inference worker outside the restartable service worker.',
    })
  })()
  try {
    await creatingDocument
  } finally {
    creatingDocument = null
  }
}
