import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { build } from 'esbuild'
import { buildExtensions } from '../build/build-extension.mjs'
import { packagedModelSource } from '../build/config.mjs'
import { discoverPackagedArtifact, extractAndVerifyPackagedArchive } from '../e2e/packaged-smoke-artifact.mjs'

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const iterations = process.argv.length === 2 ? 100 : Number(process.argv[3])
if (
  (process.argv.length !== 2 && (process.argv.length !== 4 || process.argv[2] !== '--iterations')) ||
  !Number.isSafeInteger(iterations) ||
  iterations < 1 ||
  iterations > 10_000
) {
  throw new Error('Usage: benchmark-product.mjs [--iterations 1..10000]')
}
const outputRoot = path.join(extensionRoot, 'dist', 'product-benchmark')
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-pony-product-benchmark-'))
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)

function summarize(samplesMs) {
  const sorted = [...samplesMs].sort((left, right) => left - right)
  return {
    count: sorted.length,
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  }
}

async function bundle(filename) {
  const result = await build({
    entryPoints: [path.join(extensionRoot, 'scripts/browser', filename)],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
  })
  return result.outputFiles[0].text
}

function eventOnce(session, name, predicate) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      globalThis.clearTimeout(timer)
      session.off(name, listener)
    }
    const listener = (event) => {
      if (predicate(event)) {
        cleanup()
        resolve(event)
      }
    }
    const timer = globalThis.setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for ${name}`))
    }, 15_000)
    session.on(name, listener)
  })
}

async function createClient(context, extensionId, source, index) {
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  const isolatedWorld = eventOnce(
    cdp,
    'Runtime.executionContextCreated',
    ({ context: execution }) =>
      execution.origin === `chrome-extension://${extensionId}` || execution.name === extensionId,
  )
  await cdp.send('Runtime.enable')
  await page.goto(`https://hentaiverse.org/product-benchmark-${index}`)
  const { context: execution } = await isolatedWorld
  const evaluate = async (expression) => {
    const response = await cdp.send('Runtime.evaluate', {
      contextId: execution.id,
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (response.exceptionDetails)
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text)
    return response.result.value
  }
  await evaluate(source)
  return {
    page,
    evaluate,
    close: async () => {
      await evaluate('ponyProductBenchmark.destroy()')
      await page.close()
    },
  }
}

// CDP reports V8/backing-store snapshots, not process RSS or a WASM peak.
async function heapSnapshot(cdp, targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false })
  try {
    const response = eventOnce(
      cdp,
      'Target.receivedMessageFromTarget',
      (event) => event.sessionId === sessionId && JSON.parse(event.message).id === 1,
    )
    await cdp.send('Target.sendMessageToTarget', {
      sessionId,
      message: JSON.stringify({ id: 1, method: 'Runtime.getHeapUsage' }),
    })
    const payload = JSON.parse((await response).message)
    if (payload.error) throw new Error(payload.error.message)
    return payload.result
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId })
  }
}

async function memorySnapshot(cdp, extensionId) {
  try {
    const { targetInfos } = await cdp.send('Target.getTargets')
    const offscreen = targetInfos.find((target) => target.url === `chrome-extension://${extensionId}/offscreen.html`)
    assert.ok(offscreen, 'Offscreen host is absent')
    const attached = eventOnce(
      cdp,
      'Target.attachedToTarget',
      (event) => event.targetInfo.url === `chrome-extension://${extensionId}/inference-worker.js`,
    )
    await cdp.send('Target.autoAttachRelated', {
      targetId: offscreen.targetId,
      waitForDebuggerOnStart: false,
      filter: [{ type: 'worker' }],
    })
    const { targetInfo } = await attached
    await cdp.send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true })
    return {
      offscreen: await heapSnapshot(cdp, offscreen.targetId),
      worker: await heapSnapshot(cdp, targetInfo.targetId),
    }
  } catch (error) {
    await cdp
      .send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true })
      .catch(() => undefined)
    return { unavailable: error.message }
  }
}

let context
let server
try {
  await buildExtensions({ outputRoot, targets: ['chromium'], modelDelivery: 'packaged' })
  const artifact = await discoverPackagedArtifact(outputRoot, 'chromium')
  const unpackedPath = path.join(temporaryRoot, 'extension')
  await extractAndVerifyPackagedArchive(artifact, unpackedPath)
  const [clientSource, cacheSource, modelBytes] = await Promise.all([
    bundle('product-client.mjs'),
    bundle('product-cache.mjs'),
    readFile(packagedModelSource),
  ])
  context = await chromium.launchPersistentContext(path.join(temporaryRoot, 'profile'), {
    ...(executablePath ? { executablePath } : {}),
    headless: true,
    args: [`--disable-extensions-except=${unpackedPath}`, `--load-extension=${unpackedPath}`],
  })
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }))
  const extensionId = new globalThis.URL(worker.url()).host
  const cdp = await context.browser().newBrowserCDPSession()
  // No request reaches a production origin; packaged assets stay extension-local.
  await context.route('https://**/*', async (route) => {
    if (new globalThis.URL(route.request().url()).hostname === 'hentaiverse.org') {
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local product benchmark</title>' })
    } else await route.abort('blockedbyclient')
  })
  const client = await createClient(context, extensionId, clientSource, 0)
  const coldPrepareMs = await client.evaluate('ponyProductBenchmark.prepare()')
  const warmPrepareMs = await client.evaluate('ponyProductBenchmark.prepare()')
  const first = await client.evaluate('ponyProductBenchmark.run(1)')
  const memoryBefore = await memorySnapshot(cdp, extensionId)
  const continuous = await client.evaluate(`ponyProductBenchmark.run(${iterations})`)
  assert.deepEqual(continuous.result, first.result, 'Repeated synthetic input changed its result')
  const memoryAfter = await memorySnapshot(cdp, extensionId)
  const large = await client.evaluate('ponyProductBenchmark.run(3, 4000)')
  assert.deepEqual(large.result, first.result, 'Uniform square input changed its result after resizing')
  const peers = await Promise.all([1, 2, 3].map((index) => createClient(context, extensionId, clientSource, index)))
  const parallel = await Promise.all([client, ...peers].map((peer) => peer.evaluate('ponyProductBenchmark.run(3)')))
  const cancellation = await client.evaluate('ponyProductBenchmark.cancel(20)')
  const recovery = await client.evaluate('ponyProductBenchmark.run(1)')
  const clients = await Promise.all([client, ...peers].map((peer) => peer.evaluate('ponyProductBenchmark.state()')))
  assert.ok(
    clients.every((state) => state.active === 0),
    'Client requests remained active',
  )
  await Promise.all([client, ...peers].map((peer) => peer.close()))

  let modelGets = 0
  let confirmations = 0
  server = http.createServer((request, response) => {
    if (request.url === '/model.ort') {
      modelGets += 1
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': modelBytes.length,
        'X-HV-Model-Download-Receipt': '1'.repeat(32),
      })
      response.end(modelBytes)
    } else if (request.url === '/confirm') {
      confirmations += 1
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"confirmed":true}')
    } else response.end('<!doctype html><title>Local cache benchmark</title>')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const cachePage = await context.newPage()
  await cachePage.goto(`http://127.0.0.1:${server.address().port}`)
  await cachePage.addScriptTag({ content: cacheSource })
  const cache = await cachePage.evaluate(() => globalThis.runProductCacheBenchmark())
  assert.equal(cache.binaryWrites, 1)
  assert.equal(cache.metadataWrites, 2)
  assert.equal(modelGets, 1)
  assert.equal(confirmations, 1)
  const report = {
    schemaVersion: 1,
    kind: 'extension-product-benchmark',
    browser: context.browser().version(),
    model: artifact.artifact.model,
    input: 'synthetic uniform white PNG; no accuracy claim',
    scope:
      'Production content client -> broker -> offscreen -> inference worker -> ORT; separate localhost production ModelCache replay',
    coldPrepareMs,
    warmPrepareMs,
    firstDetectMs: first.samplesMs[0],
    continuous: summarize(continuous.samplesMs),
    largeImage: {
      size: 4000,
      ...summarize(large.samplesMs),
      imageBytes: large.imageBytes,
      encodeMs: large.encodeMs,
      encodedCharacters: large.encodedCharacters,
      resultMatches: true,
    },
    multiTab: { tabs: 4, ...summarize(parallel.flatMap((entry) => entry.samplesMs)), clients },
    cancellation: { ...cancellation, recoveryMs: recovery.samplesMs[0] },
    cache: { ...cache, modelGets, confirmations, backend: 'localhost replay; no real authentication or quota service' },
    memory: {
      scope: 'Unforced-GC CDP heap snapshots; not peaks or leak proof',
      before: memoryBefore,
      after: memoryAfter,
      wasmPeakBytes: null,
      networkBufferPeakBytes: null,
      portAndListenerCounts: null,
    },
  }
  await writeFile(path.join(outputRoot, 'product-benchmark.json'), `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} finally {
  await context?.close().catch(() => undefined)
  if (server) {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
  await rm(temporaryRoot, { recursive: true, force: true })
}
