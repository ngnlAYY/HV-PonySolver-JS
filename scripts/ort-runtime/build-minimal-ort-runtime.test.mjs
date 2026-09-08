import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, URL } from 'node:url'

const scriptUrl = new URL('./build-minimal-ort-runtime.sh', import.meta.url)

test('builds JavaScript assets in a disposable copy of the pinned ORT checkout', async () => {
  const source = await readFile(scriptUrl, 'utf8')
  const initialCleanCheck = source.indexOf('assert-clean-ort-source.mjs" "$ORT_SOURCE"')
  const copy = source.indexOf('cp -a "$ORT_SOURCE/js/." "$JS_BUILD_ROOT/"')
  const trap = source.indexOf('trap cleanup_js_build_root EXIT')
  const mutation = source.indexOf('node - "$ORT_BUILD_SCRIPT" <<\'NODE\'')
  const cleanup = source.lastIndexOf('cleanup_js_build_root')
  const finalCleanCheck = source.lastIndexOf('assert-clean-ort-source.mjs" "$ORT_SOURCE"')

  assert.ok(initialCleanCheck >= 0)
  assert.ok(trap > initialCleanCheck)
  assert.ok(copy > trap)
  assert.ok(mutation > trap)
  assert.ok(cleanup > mutation)
  assert.ok(finalCleanCheck > cleanup)
  assert.match(source, /JS_BUILD_ROOT="\$BUILD_ROOT\/js-build"/u)
  assert.match(source, /npm --prefix "\$JS_BUILD_ROOT" ci/u)
  assert.match(source, /npm --prefix "\$JS_BUILD_ROOT\/common" ci/u)
  assert.match(source, /npm --prefix "\$JS_BUILD_ROOT\/web" ci/u)
  assert.match(source, /cp "\$JS_BUILD_ROOT\/web\/dist\/ort\.wasm\.bundle\.min\.mjs"/u)
  assert.doesNotMatch(source, /git -C "\$ORT_SOURCE" clean/u)
  assert.doesNotMatch(source, /npm --prefix "\$ORT_SOURCE\/js/u)
  assert.match(source, /trap - EXIT/u)
})

test('rejects invalid arguments before creating an ORT build root from an arbitrary cwd', async (t) => {
  const temporaryParent = await mkdtemp(join(tmpdir(), 'build-minimal-ort-runtime-'))
  const cwd = join(temporaryParent, 'arbitrary-cwd')
  const buildRoot = join(temporaryParent, 'hv-pony-ort-entry-smoke')
  t.after(() => rm(temporaryParent, { recursive: true, force: true }))
  await mkdir(cwd)

  const result = spawnSync('bash', [fileURLToPath(scriptUrl), '--invalid-option'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ORT_BUILD_ROOT: buildRoot },
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 2)
  const output = `${result.stdout}\n${result.stderr}`
  assert.match(output, /Usage:/u)
  assert.doesNotMatch(output, /MODULE_NOT_FOUND/u)
  await assert.rejects(access(buildRoot), { code: 'ENOENT' })
})

test('serializes destructive work and revalidates the dedicated build root', async () => {
  const source = await readFile(scriptUrl, 'utf8')
  const createdRootCheck = source.indexOf('created_build_root="$(node')
  const lock = source.indexOf('flock -n "$ORT_BUILD_LOCK_FD"')
  const firstCleanup = source.indexOf('cleanup_js_build_root\n')

  assert.match(source, /command -v flock/u)
  assert.match(source, /exec \{ORT_BUILD_LOCK_FD\}>"\$BUILD_ROOT\/\.build\.lock"/u)
  assert.ok(createdRootCheck >= 0)
  assert.ok(lock > createdRootCheck)
  assert.ok(lock >= 0)
  assert.ok(firstCleanup > lock)
  assert.match(source, /BUILD_ROOT_ID=/u)
  assert.match(source, /assert_build_root_identity/u)
  assert.match(source, /remove_build_paths "\$MODEL_INPUT" "\$MODEL_OUTPUT"/u)
  assert.match(source, /remove_build_paths "\$ARTIFACT_DIR"/u)
  assert.doesNotMatch(source, /rm -rf "\$MODEL_INPUT" "\$MODEL_OUTPUT"/u)
  assert.doesNotMatch(source, /rm -rf "\$ARTIFACT_DIR"/u)
})
