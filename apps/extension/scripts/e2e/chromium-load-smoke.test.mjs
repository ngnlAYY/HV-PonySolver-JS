import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { JSDOM } from 'jsdom'

import { fillRemoteModelKey, resolveRemoteSmokeMode, verifyRemoteModelKey } from './chromium-load-smoke.mjs'

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

test('authenticated smoke refuses automation debug logging before reading credentials', () => {
  for (const name of ['DEBUG', 'PWDEBUG']) {
    const environment = {
      [name]: '1',
      get KvKey() {
        throw new Error('credentials must not be read')
      },
    }
    assert.throws(() => resolveRemoteSmokeMode(['--authenticated'], environment), /禁止启用 DEBUG 或 PWDEBUG/u)
    assert.deepEqual(resolveRemoteSmokeMode(['--load-only'], environment), { mode: 'load-only' })
  }
})

test('sensitive fill preserves the supplied value on success', async () => {
  const fakeValue = 'public-test-value'
  let received
  await fillRemoteModelKey(
    {
      locator: () => ({
        fill: async (value) => {
          received = value
        },
      }),
    },
    fakeValue,
  )
  assert.equal(received, fakeValue)
})

test('sensitive fill discards call logs and causes even at an uncaught CLI boundary', () => {
  const moduleUrl = new globalThis.URL('./chromium-load-smoke.mjs', import.meta.url).href
  const fakeValue = 'public-fake-fill-input'
  const script = `
    import assert from 'node:assert/strict'
    import { fillRemoteModelKey } from ${JSON.stringify(moduleUrl)}
    const page = { locator: () => ({ fill: async () => {
      throw new Error('locator.fill(' + ${JSON.stringify(fakeValue)} + ') failed', {
        cause: new Error(${JSON.stringify(fakeValue)})
      })
    } }) }
    try { await fillRemoteModelKey(page, ${JSON.stringify(fakeValue)}) }
    catch (error) { assert.equal(error.cause, undefined); throw error }
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: { ...process.env, KvKey: '', DEBUG: '', PWDEBUG: '' },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /模型 Key 输入失败/u)
  assert.equal(`${result.stdout}${result.stderr}`.includes(fakeValue), false)
})

test('remote smoke requires one explicit non-ambiguous mode', () => {
  for (const args of [[], ['--unknown'], ['--load-only', '--authenticated']]) {
    assert.throws(() => resolveRemoteSmokeMode(args, {}), /Usage:/u)
  }
})

async function createSmokeFixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hv-chromium-smoke-cleanup-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const extensionRoot = fileURLToPath(new globalThis.URL('../../', import.meta.url))
  for (const file of [
    'scripts/e2e/chromium-load-smoke.mjs',
    'scripts/e2e/chromium-content-smoke.mjs',
    'scripts/browser/browser-support.mjs',
    'src/platform/extension-paths.ts',
  ]) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await copyFile(path.join(extensionRoot, file), path.join(root, file))
  }
  await symlink(path.join(extensionRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir')
  const temporaryDirectory = path.join(root, 'temporary')
  await mkdir(temporaryDirectory)
  return {
    root,
    temporaryDirectory,
    run(script, args = []) {
      return spawnSync(process.execPath, [path.join(root, 'scripts/e2e', script), ...args], {
        encoding: 'utf8',
        timeout: 15_000,
        env: {
          ...process.env,
          TMPDIR: temporaryDirectory,
          CHROMIUM_PATH: path.join(root, 'missing-chromium'),
          KvKey: '',
          DEBUG: '',
          PWDEBUG: '',
        },
      })
    },
  }
}

for (const failure of ['missing manifest', 'wrong model mode']) {
  test(`remote smoke leaves no profile after ${failure}`, async (context) => {
    const fixture = await createSmokeFixture(context)
    if (failure === 'wrong model mode') {
      const target = path.join(fixture.root, 'dist/chromium')
      await mkdir(target, { recursive: true })
      await writeFile(path.join(target, 'manifest.json'), '{}')
      await writeFile(
        path.join(target, 'build-manifest.json'),
        JSON.stringify({ target: 'chromium', modelDelivery: 'packaged' }),
      )
    }
    const result = fixture.run('chromium-load-smoke.mjs', ['--load-only'])
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, failure === 'missing manifest' ? /ENOENT/u : /requires a Chromium remote-model build/u)
    assert.deepEqual(await readdir(fixture.temporaryDirectory), [])
  })
}

for (const failure of ['build', 'launch']) {
  test(`content smoke removes temporary files after ${failure} failure`, async (context) => {
    const fixture = await createSmokeFixture(context)
    await mkdir(path.join(fixture.root, 'scripts/build'), { recursive: true })
    await writeFile(
      path.join(fixture.root, 'scripts/build/build-extension.mjs'),
      failure === 'build'
        ? 'export async function buildExtensions() { throw new Error("fixture build failure") }'
        : 'export async function buildExtensions() {}',
    )
    const result = fixture.run('chromium-content-smoke.mjs')
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, failure === 'build' ? /fixture build failure/u : /missing-chromium/u)
    const ownedDirectories = (await readdir(fixture.temporaryDirectory)).filter((name) =>
      name.startsWith('hv-pony-extension-'),
    )
    assert.deepEqual(ownedDirectories, [])
  })
}

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

test('authenticated smoke accepts the completed exhausted-quota notice as a valid saved Key', async (context) => {
  const page = verificationPage(
    context,
    '模型 Key 有效并已安全保存；本月 5 次模型下载额度已用完，额度恢复后将自动下载模型',
  )
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
