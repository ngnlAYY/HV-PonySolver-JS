// Bundled only for CDP injection into a test tab's existing extension isolated
// world. This entry is never copied into an extension artifact.
import { RemoteDetectorClient } from '../../src/content/remote-detector-client'
import { encodeImage } from '../../src/protocol/messages'

const client = new RemoteDetectorClient({ setStatus() {}, setSessionReady() {} })
let active = 0
let maximumActive = 0
let latestResult

async function imageBlob(size) {
  const canvas = new globalThis.OffscreenCanvas(size, size)
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, size, size)
  return canvas.convertToBlob({ type: 'image/png' })
}

async function detect(blob, signal) {
  active += 1
  maximumActive = Math.max(maximumActive, active)
  const startedAt = globalThis.performance.now()
  try {
    latestResult = await client.detect(blob, signal)
    return globalThis.performance.now() - startedAt
  } finally {
    active -= 1
  }
}

globalThis.ponyProductBenchmark = {
  async prepare() {
    const startedAt = globalThis.performance.now()
    await client.prepare()
    return globalThis.performance.now() - startedAt
  },
  async run(iterations, size = 640) {
    const blob = await imageBlob(size)
    const encodeStartedAt = globalThis.performance.now()
    const encoded = await encodeImage(blob)
    const encodeMs = globalThis.performance.now() - encodeStartedAt
    const samplesMs = []
    for (let index = 0; index < iterations; index += 1) samplesMs.push(await detect(blob))
    return {
      samplesMs,
      encodeMs,
      encodedCharacters: encoded.imageBase64.length,
      imageBytes: blob.size,
      result: latestResult,
    }
  },
  async cancel(iterations) {
    const blob = await imageBlob(640)
    let cancelled = 0
    let completedBeforeCancel = 0
    for (let index = 0; index < iterations; index += 1) {
      const controller = new globalThis.AbortController()
      const timer = globalThis.setTimeout(() => controller.abort(), 5)
      try {
        await detect(blob, controller.signal)
        completedBeforeCancel += 1
      } catch (error) {
        if (!controller.signal.aborted) throw error
        cancelled += 1
      } finally {
        globalThis.clearTimeout(timer)
      }
    }
    return { attempted: iterations, cancelled, completedBeforeCancel, active, maximumActive }
  },
  state() {
    return { active, maximumActive }
  },
  destroy() {
    client.destroy()
  },
}
