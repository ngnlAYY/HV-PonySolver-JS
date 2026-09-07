import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { URL } from 'node:url'

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
