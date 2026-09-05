// A localhost-only browser harness for the production downloader and IDB cache.
import { ModelCache } from '@hv-pony-solver/browser-core/model/model-cache'
import { downloadModel } from '@hv-pony-solver/browser-core/model/model-downloader'
import { modelConfig } from '@hv-pony-solver/browser-core/model/model-config'

globalThis.runProductCacheBenchmark = async () => {
  await new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.deleteDatabase(modelConfig.cacheName)
    request.onsuccess = resolve
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Benchmark database is blocked'))
  })
  let binaryWrites = 0
  let metadataWrites = 0
  let binaryBytesWritten = 0
  const originalPut = globalThis.IDBObjectStore.prototype.put
  globalThis.IDBObjectStore.prototype.put = function (value, ...args) {
    if (this.transaction.db.name === modelConfig.cacheName) {
      if (value.buffer instanceof ArrayBuffer) {
        binaryWrites += 1
        binaryBytesWritten += value.buffer.byteLength
      } else {
        metadataWrites += 1
      }
    }
    return originalPut.call(this, value, ...args)
  }
  const localFetch = (_url, init) =>
    globalThis.fetch(init?.method === 'POST' ? '/confirm' : '/model.ort', {
      method: init?.method,
      signal: init?.signal,
      redirect: 'error',
    })
  const cache = new ModelCache({ setStatus() {} }, (signal, options) =>
    downloadModel(signal, options, {
      // Public, synthetic test value; the adapter never forwards credentials.
      getAccessKey: () => '0'.repeat(64),
      fetchImpl: localFetch,
    }),
  )
  let reopened
  try {
    const missStartedAt = globalThis.performance.now()
    if ((await cache.getCached()) !== null) throw new Error('Expected an empty benchmark cache')
    const missMs = globalThis.performance.now() - missStartedAt
    const downloadStartedAt = globalThis.performance.now()
    const buffer = await cache.download()
    const downloadMs = globalThis.performance.now() - downloadStartedAt
    const writeStartedAt = globalThis.performance.now()
    await cache.putCached(buffer)
    const writeAndConfirmMs = globalThis.performance.now() - writeStartedAt
    cache.close()
    reopened = new ModelCache({ setStatus() {} })
    const hitStartedAt = globalThis.performance.now()
    const hit = await reopened.getCached()
    const hitMs = globalThis.performance.now() - hitStartedAt
    if (hit?.byteLength !== buffer.byteLength) throw new Error('Verified cache did not survive reopening')
    return { missMs, downloadMs, writeAndConfirmMs, hitMs, binaryWrites, metadataWrites, binaryBytesWritten }
  } finally {
    cache.close()
    reopened?.close()
    globalThis.IDBObjectStore.prototype.put = originalPut
  }
}
