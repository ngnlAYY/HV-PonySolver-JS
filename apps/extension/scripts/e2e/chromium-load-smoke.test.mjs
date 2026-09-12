import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'

import { resolveRemoteSmokeMode, verifyRemoteModelKey } from './chromium-load-smoke.mjs'

test('remote load-only mode never requires or implies an authenticated Key', () => {
  assert.deepEqual(resolveRemoteSmokeMode(['--load-only'], {}), { mode: 'load-only' })
})

test('authenticated remote CI branch fails closed when KvKey is absent', () => {
  for (const environment of [{}, { KvKey: '' }, { KvKey: '   ' }]) {
    assert.throws(
      () => resolveRemoteSmokeMode(['--authenticated'], environment),
      /KvKey is required for the authenticated remote inference smoke/u,
    )
  }
  assert.deepEqual(resolveRemoteSmokeMode(['--authenticated'], { KvKey: ' test-key ' }), {
    mode: 'authenticated',
    key: 'test-key',
  })
})

test('remote smoke requires one explicit non-ambiguous mode', () => {
  for (const args of [[], ['--unknown'], ['--load-only', '--authenticated']]) {
    assert.throws(() => resolveRemoteSmokeMode(args, {}), /Usage:/u)
  }
})

function verificationPage(context, outcome) {
  const dom = new JSDOM('<p id="status">设置已保存</p><button id="cancel-key-op" disabled></button>')
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
  context.after(() => {
    dom.window.close()
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
    else delete globalThis.document
  })
  const status = dom.window.document.querySelector('#status')
  const cancel = dom.window.document.querySelector('#cancel-key-op')
  let finished = false
  return {
    get finished() {
      return finished
    },
    evaluate: (callback) => callback(),
    locator: (selector) => ({
      async click() {
        assert.equal(selector, '#verify-key')
        if (outcome === undefined) return
        cancel.disabled = false
        // The old saved status can remain while the queued operation starts.
        await new Promise((resolve) => globalThis.setTimeout(resolve, 1))
        status.textContent = '正在验证模型 Key…'
        if (outcome !== null) {
          const timer = globalThis.setTimeout(() => {
            status.textContent = outcome
            cancel.disabled = true
            finished = true
          }, 20)
          context.after(() => globalThis.clearTimeout(timer))
        }
      },
      async textContent() {
        return status.textContent
      },
    }),
    async waitForFunction(predicate, argument, options) {
      assert.equal(options.timeout, 120_000)
      const deadline = Date.now() + (typeof outcome === 'string' ? 5_000 : 60)
      while (!predicate(argument)) {
        if (Date.now() >= deadline) throw new Error('verification wait timed out')
        await new Promise((resolve) => globalThis.setTimeout(resolve, 1))
      }
    },
  }
}

test('authenticated smoke waits for delayed verification completion instead of pending or saved status', async (context) => {
  const page = verificationPage(context, '模型 Key 验证成功并已安全保存')
  await verifyRemoteModelKey(page)
  assert.equal(page.finished, true)
})

test('authenticated smoke reports the completed verification failure', async (context) => {
  const page = verificationPage(context, '模型 Key 无效：HTTP 403')
  await assert.rejects(verifyRemoteModelKey(page), /模型 Key 无效：HTTP 403/u)
  assert.equal(page.finished, true)
})

test('authenticated smoke retains the verification wait timeout', async (context) => {
  const page = verificationPage(context, null)
  await assert.rejects(verifyRemoteModelKey(page), /verification wait timed out/u)
})

test('authenticated smoke cannot reuse a previous saved status if verification never starts', async (context) => {
  const page = verificationPage(context, undefined)
  await assert.rejects(verifyRemoteModelKey(page), /verification wait timed out/u)
  assert.equal(page.finished, false)
})
