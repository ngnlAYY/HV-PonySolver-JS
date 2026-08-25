import assert from 'node:assert/strict'
import test from 'node:test'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scriptPath = join(repoRoot, 'scripts/check-docs-drift.mjs')

async function runCheck(cwd) {
  try {
    const result = await execFileAsync(process.execPath, [scriptPath, '--repo-root', cwd], { cwd })
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    return {
      exitCode: error.code ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    }
  }
}

async function createFixture() {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'hv-docs-drift-'))
  const files = [
    'README.md',
    'package.json',
    'apps/userscript/package.json',
    'apps/extension/package.json',
    'apps/extension/scripts/build-extension.mjs',
    'apps/extension/scripts/browser-support.mjs',
    'docs/browser-extension.md',
    'packages/browser-core/src/inference/inference-config.ts',
    'apps/userscript/src/inference/onnx-runtime-assets.ts',
    'apps/model-worker/src/request-router.ts',
    'apps/model-worker/src/model-access.ts',
    'apps/model-worker/src/model-response.ts',
    'packages/shared/src/model.ts',
  ]

  await Promise.all(
    files.map(async (file) => {
      await mkdir(join(fixtureRoot, dirname(file)), { recursive: true })
      await copyFile(join(repoRoot, file), join(fixtureRoot, file))
    }),
  )
  return fixtureRoot
}

async function withFixture(callback) {
  const fixtureRoot = await createFixture()
  try {
    return await callback(fixtureRoot)
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
}

test('current repository README is in sync with source facts', async () => {
  const result = await runCheck(repoRoot)
  assert.equal(result.exitCode, 0, result.stderr)
  assert.match(result.stdout, /Docs drift check passed/)
})

for (const [browser, minimum, errorLabel] of [
  ['Firefox Desktop', '140', 'Firefox Desktop minimum version 140\\.0'],
  ['Firefox Android', '142', 'Firefox Android minimum version 142\\.0'],
]) {
  test(`fails clearly when extension docs omit the generated ${browser} minimum version`, async () => {
    await withFixture(async (fixtureRoot) => {
      const readmePath = join(fixtureRoot, 'README.md')
      const extensionDocPath = join(fixtureRoot, 'docs/browser-extension.md')
      await writeFile(readmePath, (await readFile(readmePath, 'utf8')).replaceAll(minimum, `current ${browser}`))
      await writeFile(
        extensionDocPath,
        (await readFile(extensionDocPath, 'utf8')).replaceAll(minimum, `current ${browser}`),
      )

      const result = await runCheck(fixtureRoot)
      assert.notEqual(result.exitCode, 0)
      assert.match(result.stderr, new RegExp(`extension documentation omits ${errorLabel}`))
    })
  })
}

for (const [fact, replacement] of [
  ['--model-mode packaged', '--model-mode local'],
  ['model/yolo26n-640.ort', 'model/omitted.ort'],
  ['hv-pony-solver-firefox-packaged-<version>.zip', 'omitted-firefox-package.zip'],
  ['modelDelivery', 'omittedDelivery'],
  ['当前版本已内置模型，无需配置模型 Key。', '内置提示已省略'],
  ['ArrayBuffer', 'binary payload'],
]) {
  test(`fails clearly when extension docs omit ${fact}`, async () => {
    await withFixture(async (fixtureRoot) => {
      for (const relativePath of ['README.md', 'docs/browser-extension.md']) {
        const documentPath = join(fixtureRoot, relativePath)
        await writeFile(documentPath, (await readFile(documentPath, 'utf8')).replaceAll(fact, replacement))
      }

      const result = await runCheck(fixtureRoot)
      assert.notEqual(result.exitCode, 0)
      assert.match(
        result.stderr,
        new RegExp(`extension documentation omits ${fact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      )
    })
  })
}

for (const [directive, replacement] of [
  ["object-src 'none'", "object-src 'self'"],
  ["worker-src 'self'", "worker-src 'none'"],
]) {
  test(`fails clearly when extension docs mutate CSP directive ${directive}`, async () => {
    await withFixture(async (fixtureRoot) => {
      const extensionDocPath = join(fixtureRoot, 'docs/browser-extension.md')
      const extensionDoc = await readFile(extensionDocPath, 'utf8')
      assert.ok(extensionDoc.includes(directive), `fixture should mention ${directive}`)
      await writeFile(extensionDocPath, extensionDoc.replaceAll(directive, replacement))

      const result = await runCheck(fixtureRoot)
      assert.notEqual(result.exitCode, 0)
      const escapedDirective = directive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      assert.match(result.stderr, new RegExp(`extension documentation omits ${escapedDirective}`))
    })
  })
}

// README 文档契约：这些测试验证 README 是否准确描述脚本、模型、ONNX Runtime 和 Model Worker 的当前事实。
// 运行时 HTTP 行为应由 apps/model-worker 的 Worker tests 覆盖；这里关注文档是否漂移。
const rootCheckCommandNames = [
  'check:quick',
  'test:coverage',
  'build',
  'docs:check',
  'architecture:check',
  'browser-sinks:check',
  'bundle:check',
]

for (const commandName of rootCheckCommandNames) {
  test(`fails clearly when README omits ${commandName} from pnpm check description`, async () => {
    await withFixture(async (fixtureRoot) => {
      const readmePath = join(fixtureRoot, 'README.md')
      const readme = await readFile(readmePath, 'utf8')
      assert.ok(readme.includes(commandName), `fixture should mention ${commandName}`)
      await writeFile(readmePath, readme.replaceAll(commandName, 'omitted check command'))

      const escapedCommandName = commandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const result = await runCheck(fixtureRoot)
      assert.notEqual(result.exitCode, 0)
      assert.match(result.stderr, new RegExp(`README\\.md.*pnpm check.*${escapedCommandName}`, 's'))
    })
  })
}

test('fails clearly when pnpm check references a missing check:quick script', async () => {
  await withFixture(async (fixtureRoot) => {
    const packageJsonPath = join(fixtureRoot, 'package.json')
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
    delete packageJson.scripts['check:quick']
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /package\.json scripts\.check:quick is missing/s)
  })
})

test('fails clearly when README omits a core userscript inference config name', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(readmePath, readme.replaceAll('workerDetectTimeoutMs', 'workerDetectTimeout'))

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*workerDetectTimeoutMs/s)
  })
})

test('fails clearly when README omits a focused userscript inference config export', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(readmePath, readme.replaceAll('imagePreprocessConfig', 'image preprocess config'))

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*imagePreprocessConfig/s)
  })
})

test('fails clearly when README omits model manifest field names', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(
      readmePath,
      readme
        .replaceAll('MODEL_INTEGRITY.byteLength', 'MODEL_INTEGRITY byte length')
        .replaceAll('MODEL_INTEGRITY.sha256', 'MODEL_INTEGRITY sha256'),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*MODEL_INTEGRITY\.byteLength/s)
    assert.match(result.stderr, /README.md.*MODEL_INTEGRITY\.sha256/s)
  })
})

test('fails clearly when README omits verify-model-integrity and MODEL_FILE', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(
      readmePath,
      readme.replaceAll('verify-model-integrity', 'verify model integrity').replaceAll('MODEL_FILE', 'MODEL PATH'),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*verify-model-integrity/s)
    assert.match(result.stderr, /README.md.*MODEL_FILE/s)
  })
})

test('fails clearly when README omits ONNX Runtime asset manifest field names', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(
      readmePath,
      readme
        .replaceAll('ONNX_RUNTIME_ASSETS', 'ONNX Runtime assets')
        .replaceAll('bundleAsset.byteLength', 'bundle asset byte length')
        .replaceAll('bundleAsset.sha256', 'bundle asset sha256')
        .replaceAll('bundleAsset.maxByteLength', 'bundle asset max byte length')
        .replaceAll('wasmAsset.byteLength', 'wasm asset byte length')
        .replaceAll('wasmAsset.sha256', 'wasm asset sha256')
        .replaceAll('wasmAsset.maxByteLength', 'wasm asset max byte length'),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*ONNX_RUNTIME_ASSETS/s)
    assert.match(result.stderr, /README.md.*bundleAsset\.byteLength/s)
    assert.match(result.stderr, /README.md.*bundleAsset\.sha256/s)
    assert.match(result.stderr, /README.md.*bundleAsset\.maxByteLength/s)
    assert.match(result.stderr, /README.md.*wasmAsset\.byteLength/s)
    assert.match(result.stderr, /README.md.*wasmAsset\.sha256/s)
    assert.match(result.stderr, /README.md.*wasmAsset\.maxByteLength/s)
  })
})

test('fails clearly when README omits ONNX Runtime asset package facts', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(
      readmePath,
      readme
        .replaceAll('onnxruntime-web', 'onnx runtime web')
        .replaceAll('1.27.0', '1.x')
        .replaceAll('8f0278c77bf44b0cc83c098c6c722b92a36ac4b5', 'source commit')
        .replaceAll('4.0.23', 'emsdk version'),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*onnxruntime-web/s)
    assert.match(result.stderr, /README.md.*1\.27\.0/s)
    assert.match(result.stderr, /README.md.*8f0278c77bf44b0cc83c098c6c722b92a36ac4b5/s)
    assert.match(result.stderr, /README.md.*4\.0\.23/s)
  })
})

test('fails clearly when README omits ONNX Runtime asset verification command and behavior', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(
      readmePath,
      readme
        .replaceAll('verify:onnx-runtime', 'verify onnx runtime')
        .replaceAll('build:onnx-runtime', 'build onnx runtime')
        .replaceAll('wasmAsset.url', 'wasm asset url')
        .replaceAll('externalFullRuntime', 'external full runtime')
        .replaceAll('bundledMinimalRuntime', 'bundled minimal runtime'),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*verify:onnx-runtime/s)
    assert.match(result.stderr, /README.md.*build:onnx-runtime/s)
    assert.match(result.stderr, /README.md.*wasmAsset\.url/s)
    assert.match(result.stderr, /README.md.*externalFullRuntime/s)
    assert.match(result.stderr, /README.md.*bundledMinimalRuntime/s)
  })
})

test('fails clearly when README authorized model row omits Bearer auth', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    assert.ok(readme.includes('携带 `Authorization: Bearer <authorized-64-hex>` 且 KV 命中'))
    await writeFile(
      readmePath,
      readme.replace(
        '携带 `Authorization: Bearer <authorized-64-hex>` 且 KV 命中',
        '携带 authorized header 且 KV 命中',
      ),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*authorized real-model row must mention Authorization: Bearer/s)
  })
})

test('fails clearly when README authorized model row omits cache-control', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    assert.ok(readme.includes('`200` 真实模型，模型响应使用 `Cache-Control: no-store`'))
    await writeFile(
      readmePath,
      readme.replace(
        '`200` 真实模型，模型响应使用 `Cache-Control: no-store`',
        '`200` 真实模型，模型响应使用 cache-control header',
      ),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*authorized real-model row must mention Cache-Control: no-store/s)
  })
})

test('fails clearly when README authorized HEAD row omits Bearer auth', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    assert.ok(readme.includes('| `HEAD /yolo26n-640.onnx` 携带 `Authorization: Bearer <authorized-64-hex>` 且 KV 命中'))
    await writeFile(
      readmePath,
      readme.replace(
        '| `HEAD /yolo26n-640.onnx` 携带 `Authorization: Bearer <authorized-64-hex>` 且 KV 命中',
        '| `HEAD /yolo26n-640.onnx` 携带 authorized header 且 KV 命中',
      ),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*authorized HEAD row must mention Authorization: Bearer/s)
  })
})

test('fails clearly when README authorized GET row cache-control is masked by explanatory text', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    assert.ok(readme.includes('`200` 真实模型，模型响应使用 `Cache-Control: no-store`'))
    await writeFile(
      readmePath,
      `${readme.replace(
        '`200` 真实模型，模型响应使用 `Cache-Control: no-store`',
        '`200` 真实模型，模型响应使用 cache-control header',
      )}\n附注：KV 命中后返回真实模型时仍会发送 \`Cache-Control: no-store\`。\n`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*authorized real-model row must mention Cache-Control: no-store/s)
  })
})

test('fails clearly when README authorized GET row Bearer auth is masked by explanatory text', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    assert.ok(readme.includes('携带 `Authorization: Bearer <authorized-64-hex>` 且 KV 命中'))
    await writeFile(
      readmePath,
      `${readme.replace(
        '携带 `Authorization: Bearer <authorized-64-hex>` 且 KV 命中',
        '携带 authorized header 且 KV 命中',
      )}\n附注：KV 命中后返回真实模型时仍会发送 \`Authorization: Bearer <authorized-64-hex>\`。\n`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*authorized real-model row must mention Authorization: Bearer/s)
  })
})

test('fails clearly when README quota OPTIONS row headers are masked by explanatory text', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    assert.ok(
      readme.includes(
        '`204` preflight，`Access-Control-Allow-Methods: GET, POST, OPTIONS`，`Access-Control-Allow-Headers: Authorization, X-HV-Model-Download-Receipt`',
      ),
    )
    await writeFile(
      readmePath,
      `${readme.replace(
        '`204` preflight，`Access-Control-Allow-Methods: GET, POST, OPTIONS`，`Access-Control-Allow-Headers: Authorization, X-HV-Model-Download-Receipt`',
        '`204` preflight，preflight headers documented elsewhere',
      )}\n附注：preflight 会发送 \`Access-Control-Allow-Methods: GET, POST, OPTIONS\` 和 \`Access-Control-Allow-Headers: Authorization, X-HV-Model-Download-Receipt\`。\n`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*quota OPTIONS docs must mention Access-Control-Allow-Methods/s)
    assert.match(result.stderr, /README.md.*quota OPTIONS docs must mention Access-Control-Allow-Headers/s)
  })
})

test('fails clearly when README 405 row Allow header is masked by explanatory text', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    assert.ok(readme.includes('`405 Method Not Allowed`，`Allow: GET, HEAD, OPTIONS`'))
    await writeFile(
      readmePath,
      readme
        .replace(
          '### HTTP 行为\n\n',
          '### HTTP 行为\n\n附注：405 Method Not Allowed 响应会发送 `Allow: GET, HEAD, OPTIONS`。\n',
        )
        .replace(
          '`405 Method Not Allowed`，`Allow: GET, HEAD, OPTIONS`',
          '`405 Method Not Allowed`，Allow header documented elsewhere',
        ),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*405 docs must mention Allow: GET, HEAD, OPTIONS/s)
  })
})

test('fails clearly when README selected R2 missing row is masked by explanatory text', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    assert.match(readme, /\| 选中的 R2 object 缺失\s+\| `500 Internal Server Error`/)
    await writeFile(
      readmePath,
      readme
        .replace(
          '### HTTP 行为\n\n',
          '### HTTP 行为\n\n附注：selected R2 object missing 会返回 `500 Internal Server Error`。\n',
        )
        .replace(
          /\| 选中的 R2 object 缺失\s+\| `500 Internal Server Error`\s+\|/,
          '| R2 对象缺失                                                   | 内部错误，状态码见附注                         |',
        ),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*selected R2 object missing docs must mention 500 Internal Server Error/s)
  })
})

test('fails clearly when Model Worker source allowed methods drift from README', async () => {
  await withFixture(async (fixtureRoot) => {
    const routerPath = join(fixtureRoot, 'apps/model-worker/src/request-router.ts')
    const routerSource = await readFile(routerPath, 'utf8')
    assert.ok(routerSource.includes("const ALLOWED_METHODS = 'GET, HEAD, OPTIONS'"))
    assert.ok(routerSource.includes("const QUOTA_ALLOWED_METHODS = 'GET, POST, OPTIONS'"))
    await writeFile(
      routerPath,
      routerSource
        .replace("const ALLOWED_METHODS = 'GET, HEAD, OPTIONS'", "const ALLOWED_METHODS = 'GET, HEAD'")
        .replace("const QUOTA_ALLOWED_METHODS = 'GET, POST, OPTIONS'", "const QUOTA_ALLOWED_METHODS = 'GET, OPTIONS'"),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*405 docs must mention Allow: GET, HEAD/s)
    assert.match(result.stderr, /README.md.*model OPTIONS docs must mention Access-Control-Allow-Methods: GET, HEAD/s)
    assert.match(
      result.stderr,
      /README.md.*quota OPTIONS docs must mention Access-Control-Allow-Methods: GET, OPTIONS/s,
    )
    assert.match(result.stderr, /README.md.*runtime OPTIONS docs must mention Access-Control-Allow-Methods: GET, HEAD/s)
  })
})

test('fails clearly when Model Worker source auth and response facts drift from README', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const responsePath = join(fixtureRoot, 'apps/model-worker/src/model-response.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    const responseSource = await readFile(responsePath, 'utf8')
    assert.ok(accessSource.includes("request.headers.get('authorization')"))
    assert.ok(accessSource.includes('^Bearer\\s+'))
    assert.ok(responseSource.includes("const CACHE_CONTROL = 'no-store'"))
    assert.ok(responseSource.includes('textResponse(request, INTERNAL_ERROR_MESSAGE, 500'))
    await writeFile(
      accessPath,
      accessSource
        .replace("request.headers.get('authorization')", "request.headers.get('x-model-token')")
        .replace('^Bearer\\s+', '^Token\\s+'),
    )
    await writeFile(
      responsePath,
      responseSource
        .replace("const CACHE_CONTROL = 'no-store'", "const CACHE_CONTROL = 'private, no-cache'")
        .replace(
          'textResponse(request, INTERNAL_ERROR_MESSAGE, 500',
          'textResponse(request, INTERNAL_ERROR_MESSAGE, 404',
        ),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
    assert.match(result.stderr, /README.md.*authorized real-model row must mention Cache-Control: private, no-cache/s)
    assert.match(result.stderr, /README.md.*selected R2 object missing docs must mention 404 Internal Server Error/s)
  })
})

test('fails clearly when Model Worker source string facts drift is masked by regex literals', async () => {
  await withFixture(async (fixtureRoot) => {
    const routerPath = join(fixtureRoot, 'apps/model-worker/src/request-router.ts')
    const responsePath = join(fixtureRoot, 'apps/model-worker/src/model-response.ts')
    const routerSource = await readFile(routerPath, 'utf8')
    const responseSource = await readFile(responsePath, 'utf8')
    await writeFile(
      routerPath,
      `/const ALLOWED_METHODS = 'GET, HEAD, OPTIONS'/
/const QUOTA_ALLOWED_METHODS = 'GET, POST, OPTIONS'/
${routerSource
  .replace("const ALLOWED_METHODS = 'GET, HEAD, OPTIONS'", "const ALLOWED_METHODS = 'GET, HEAD'")
  .replace("const QUOTA_ALLOWED_METHODS = 'GET, POST, OPTIONS'", "const QUOTA_ALLOWED_METHODS = 'GET, OPTIONS'")}`,
    )
    await writeFile(
      responsePath,
      `/const CACHE_CONTROL = 'no-store'/
/if (object === null) { return textResponse(request, INTERNAL_ERROR_MESSAGE, 500) }/
${responseSource
  .replace("const CACHE_CONTROL = 'no-store'", "const CACHE_CONTROL = 'private, no-cache'")
  .replace('textResponse(request, INTERNAL_ERROR_MESSAGE, 500', 'textResponse(request, INTERNAL_ERROR_MESSAGE, 404')}`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*405 docs must mention Allow: GET, HEAD/s)
    assert.match(result.stderr, /README.md.*model OPTIONS docs must mention Access-Control-Allow-Methods: GET, HEAD/s)
    assert.match(
      result.stderr,
      /README.md.*quota OPTIONS docs must mention Access-Control-Allow-Methods: GET, OPTIONS/s,
    )
    assert.match(result.stderr, /README.md.*authorized real-model row must mention Cache-Control: private, no-cache/s)
    assert.match(result.stderr, /README.md.*selected R2 object missing docs must mention 404 Internal Server Error/s)
  })
})

test('fails clearly when Model Worker string facts use runtime expressions', async () => {
  await withFixture(async (fixtureRoot) => {
    const routerPath = join(fixtureRoot, 'apps/model-worker/src/request-router.ts')
    const responsePath = join(fixtureRoot, 'apps/model-worker/src/model-response.ts')
    const routerSource = await readFile(routerPath, 'utf8')
    const responseSource = await readFile(responsePath, 'utf8')
    await writeFile(
      routerPath,
      routerSource.replace(
        "const MODEL_ALLOWED_HEADERS = 'Authorization'",
        "const MODEL_ALLOWED_HEADERS = 'Authorization'.toLowerCase()",
      ),
    )
    await writeFile(
      responsePath,
      responseSource.replace(
        "const CACHE_CONTROL = 'no-store'",
        "const CACHE_CONTROL = 'no-store' + ', max-age=86400'",
      ),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-response\.ts.*CACHE_CONTROL.*string literal/s)
    assert.match(result.stderr, /apps\/model-worker\/src\/request-router\.ts.*MODEL_ALLOWED_HEADERS.*string literal/s)
  })
})

test('accepts Model Worker string facts with TypeScript-only annotations', async () => {
  await withFixture(async (fixtureRoot) => {
    const routerPath = join(fixtureRoot, 'apps/model-worker/src/request-router.ts')
    const responsePath = join(fixtureRoot, 'apps/model-worker/src/model-response.ts')
    const routerSource = await readFile(routerPath, 'utf8')
    const responseSource = await readFile(responsePath, 'utf8')
    await writeFile(
      routerPath,
      routerSource
        .replace(
          "const ALLOWED_METHODS = 'GET, HEAD, OPTIONS'",
          "const ALLOWED_METHODS: string = 'GET, HEAD, OPTIONS' as const",
        )
        .replace(
          "const MODEL_ALLOWED_HEADERS = 'Authorization'",
          "const MODEL_ALLOWED_HEADERS: string = 'Authorization' as const",
        ),
    )
    await writeFile(
      responsePath,
      responseSource.replace("const CACHE_CONTROL = 'no-store'", "const CACHE_CONTROL: string = 'no-store' as const"),
    )

    const result = await runCheck(fixtureRoot)
    assert.equal(result.exitCode, 0, result.stderr)
  })
})

test('accepts Model Worker string facts with combined TypeScript-only suffixes', async () => {
  await withFixture(async (fixtureRoot) => {
    const routerPath = join(fixtureRoot, 'apps/model-worker/src/request-router.ts')
    const routerSource = await readFile(routerPath, 'utf8')
    await writeFile(
      routerPath,
      routerSource
        .replace(
          "const ALLOWED_METHODS = 'GET, HEAD, OPTIONS'",
          "const ALLOWED_METHODS = 'GET, HEAD, OPTIONS' as const satisfies string",
        )
        .replace(
          "const MODEL_ALLOWED_HEADERS = 'Authorization'",
          "const MODEL_ALLOWED_HEADERS = 'Authorization' as const satisfies string",
        ),
    )

    const result = await runCheck(fixtureRoot)
    assert.equal(result.exitCode, 0, result.stderr)
  })
})

test('fails clearly when Model Worker response header use-sites bypass source facts', async () => {
  await withFixture(async (fixtureRoot) => {
    const routerPath = join(fixtureRoot, 'apps/model-worker/src/request-router.ts')
    const responsePath = join(fixtureRoot, 'apps/model-worker/src/model-response.ts')
    const routerSource = await readFile(routerPath, 'utf8')
    const responseSource = await readFile(responsePath, 'utf8')
    await writeFile(
      routerPath,
      routerSource
        .replace('allowMethods: isQuota ? QUOTA_ALLOWED_METHODS : ALLOWED_METHODS', "allowMethods: 'GET, HEAD'")
        .replace(
          'allowHeaders: isQuota ? QUOTA_ALLOWED_HEADERS : MODEL_ALLOWED_HEADERS',
          "allowHeaders: 'X-Model-Token'",
        ),
    )
    await writeFile(
      responsePath,
      responseSource
        .replace(
          "headers.set('access-control-allow-headers', policy.allowHeaders)",
          "headers.set('access-control-allow-headers', 'X-Model-Token')",
        )
        .replace("'access-control-allow-methods': policy.allowMethods", "'access-control-allow-methods': 'GET, HEAD'")
        .replaceAll("'cache-control': CACHE_CONTROL", "'cache-control': 'private, no-cache'"),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/request-router\.ts.*route-specific preflight methods/s)
    assert.match(result.stderr, /apps\/model-worker\/src\/request-router\.ts.*route-specific preflight headers/s)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-response\.ts.*policy\.allowHeaders/s)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-response\.ts.*policy\.allowMethods/s)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-response\.ts.*CACHE_CONTROL/s)
  })
})

test('fails clearly when Model Worker response header use-site drift is masked by regex decoys', async () => {
  await withFixture(async (fixtureRoot) => {
    const responsePath = join(fixtureRoot, 'apps/model-worker/src/model-response.ts')
    const responseSource = await readFile(responsePath, 'utf8')
    await writeFile(
      responsePath,
      `/headers\\.set\\('access-control-allow-headers', policy\\.allowHeaders\\)/
/'access-control-allow-methods': policy\\.allowMethods/
${responseSource
  .replace(
    "headers.set('access-control-allow-headers', policy.allowHeaders)",
    "headers.set('access-control-allow-headers', 'X-Model-Token')",
  )
  .replace("'access-control-allow-methods': policy.allowMethods", "'access-control-allow-methods': 'GET, HEAD'")}`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-response\.ts.*policy\.allowHeaders/s)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-response\.ts.*policy\.allowMethods/s)
  })
})

test('fails clearly when selected R2 miss status is masked by an earlier decoy branch', async () => {
  await withFixture(async (fixtureRoot) => {
    const responsePath = join(fixtureRoot, 'apps/model-worker/src/model-response.ts')
    const responseSource = await readFile(responsePath, 'utf8')
    await writeFile(
      responsePath,
      responseSource
        .replace(
          'textResponse(request, INTERNAL_ERROR_MESSAGE, 500',
          'textResponse(request, INTERNAL_ERROR_MESSAGE, 404',
        )
        .replace(
          'export async function createModelResponse',
          `function decoySelectedObjectMissingStatus(object: unknown, request: Request): Response | null {
  if (object === null) { return textResponse(request, INTERNAL_ERROR_MESSAGE, 500) }
  return null
}

export async function createModelResponse`,
        ),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*selected R2 object missing docs must mention 404 Internal Server Error/s)
  })
})

test('accepts selected R2 miss status with equivalent null-guard shape', async () => {
  await withFixture(async (fixtureRoot) => {
    const responsePath = join(fixtureRoot, 'apps/model-worker/src/model-response.ts')
    const responseSource = await readFile(responsePath, 'utf8')
    await writeFile(
      responsePath,
      responseSource.replace(
        `if (object === null) {
    return textResponse(request, INTERNAL_ERROR_MESSAGE, 500, { 'content-type': 'text/plain;charset=UTF-8' })
  }`,
        `if (null === object) return textResponse(
    request,
    INTERNAL_ERROR_MESSAGE,
    500,
    { 'content-type': 'text/plain;charset=UTF-8' },
  )`,
      ),
    )

    const result = await runCheck(fixtureRoot)
    assert.equal(result.exitCode, 0, result.stderr)
  })
})

test('fails clearly when selected R2 miss status is masked by nested dead decoy after bucket get', async () => {
  await withFixture(async (fixtureRoot) => {
    const responsePath = join(fixtureRoot, 'apps/model-worker/src/model-response.ts')
    const responseSource = await readFile(responsePath, 'utf8')
    await writeFile(
      responsePath,
      responseSource
        .replace(
          'textResponse(request, INTERNAL_ERROR_MESSAGE, 500',
          'textResponse(request, INTERNAL_ERROR_MESSAGE, 404',
        )
        .replace(
          'const object = await env.modelBucket.get(objectKey)',
          'const object = await env.modelBucket.get(objectKey)\n  if (false) { if (object === null) { return textResponse(request, INTERNAL_ERROR_MESSAGE, 500) } }',
        ),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*selected R2 object missing docs must mention 404 Internal Server Error/s)
  })
})

test('fails clearly when Model Worker source auth drift is masked by comments', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    await writeFile(
      accessPath,
      `${accessSource
        .replace("request.headers.get('authorization')", "request.headers.get('x-model-token')")
        .replace('^Bearer\\s+', '^Token\\s+')}
// decoy: request.headers.get('authorization') and /^Bearer\\s+/
`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
  })
})

test('fails clearly when Model Worker source auth drift is masked by strings', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    await writeFile(
      accessPath,
      `${accessSource
        .replace("request.headers.get('authorization')", "request.headers.get('x-model-token')")
        .replace('^Bearer\\s+', '^Token\\s+')}
const decoy = "request.headers.get('authorization') /^Bearer\\\\s+/"
const templateDecoy = \`request.headers.get('authorization') /^Bearer\\\\s+/\`
`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
  })
})

test('fails clearly when Model Worker source auth drift is masked by regex literals', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    await writeFile(
      accessPath,
      `${accessSource
        .replace("request.headers.get('authorization')", "request.headers.get('x-model-token')")
        .replace('^Bearer\\s+', '^Token\\s+')}
/request.headers.get('authorization')/
/^Bearer\\s+/
`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
  })
})

test('fails clearly when Bearer authorization pattern has no token capture group', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    await writeFile(accessPath, accessSource.replace('([^\\s]+)', '(?:[^\\s]+)'))

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
  })
})

test('fails clearly when Authorization header read is only a dead-code decoy', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    await writeFile(
      accessPath,
      `${accessSource.replace("request.headers.get('authorization')", "request.headers.get('x-model-token')")}
if (false) {
  request.headers.get('authorization')
}
`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
  })
})

test('fails clearly when Bearer exec is only a dead-code decoy', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    await writeFile(
      accessPath,
      `${accessSource.replace('BEARER_AUTHORIZATION_PATTERN.exec(authorization.trim())', '/^Token\\s+([^\\s]+)$/i.exec(authorization.trim())')}
if (false) {
  BEARER_AUTHORIZATION_PATTERN.exec('Bearer decoy')
}
`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
  })
})

test('fails clearly when stale top-level Bearer pattern is unused by token parser', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    await writeFile(
      accessPath,
      `${accessSource
        .replace(
          'const BEARER_AUTHORIZATION_PATTERN = /^Bearer\\s+([^\\s]+)$/i',
          'const BEARER_AUTHORIZATION_PATTERN = /^Bearer\\s+([^\\s]+)$/i\nconst TOKEN_AUTHORIZATION_PATTERN = /^Token\\s+([^\\s]+)$/i',
        )
        .replace(
          'BEARER_AUTHORIZATION_PATTERN.exec(authorization.trim())',
          'TOKEN_AUTHORIZATION_PATTERN.exec(authorization.trim())',
        )}
if (false) {
  BEARER_AUTHORIZATION_PATTERN.exec('Bearer decoy')
}
`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
  })
})

test('fails clearly when Bearer token parser is unused by model access selection', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    assert.ok(accessSource.includes('const lookupKeys = getModelAccessTokenLookupKeys(requestToken)'))
    await writeFile(
      accessPath,
      accessSource.replace(
        'const lookupKeys = getModelAccessTokenLookupKeys(requestToken)',
        "const lookupKeys = getModelAccessTokenLookupKeys(request.headers.get('x-model-token'))",
      ),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
  })
})

test('fails clearly when the Authorization header is parsed more than once per request', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    assert.ok(accessSource.includes('const canonicalToken = normalizeModelAccessToken(requestToken)'))
    await writeFile(
      accessPath,
      accessSource.replace(
        'const canonicalToken = normalizeModelAccessToken(requestToken)',
        'const canonicalToken = normalizeModelAccessToken(getRequestAccessToken(request))',
      ),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
  })
})

test('fails clearly when Bearer authorization pattern drift is masked by regex literal const decoy', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    await writeFile(
      accessPath,
      `/[const BEARER_AUTHORIZATION_PATTERN = /^Bearer\\s+]/
${accessSource.replace('^Bearer\\s+', '^Token\\s+')}`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
  })
})

test('fails clearly when Bearer authorization pattern drift is masked by inner const decoy', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    await writeFile(
      accessPath,
      `${accessSource.replace('^Bearer\\s+', '^Token\\s+')}
if (false) {
  const BEARER_AUTHORIZATION_PATTERN = /^Bearer\\s+([^\\s]+)$/i
  BEARER_AUTHORIZATION_PATTERN.exec('Bearer decoy')
}
`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
  })
})

test('accepts Model Worker source auth with comment and string decoys', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    await writeFile(
      accessPath,
      `${accessSource}
// decoy: request.headers.get('x-model-token') and /^Token\\s+/
const decoy = "request.headers.get('x-model-token') /^Token\\\\s+/"
const templateDecoy = \`request.headers.get('x-model-token') /^Token\\\\s+/\`
`,
    )

    const result = await runCheck(fixtureRoot)
    assert.equal(result.exitCode, 0, result.stderr)
  })
})

test('fails clearly when README documents query-string model key authorization', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(readmePath, `${readme}\nGET /yolo26n-640.onnx?key=<authorized-64-hex> returns real model.\n`)

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*query-string key authorization or real model access/s)
  })
})

test('fails clearly when README documents query-string model key authorization on any model path', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(readmePath, `${readme}\nGET /models/custom.onnx?key=<authorized-64-hex> returns real model.\n`)

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*query-string key authorization or real model access/s)
  })
})

test('fails clearly when README says query-string key returns the real model in Chinese', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(readmePath, `${readme}\nquery string key 返回真实模型。\n`)

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*query-string key authorization or real model access/s)
  })
})

test('fails clearly when README URL query key returns the real model in Chinese', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(readmePath, `${readme}\nGET /yolo26n-640.onnx?key=<authorized-64-hex> 返回真实模型。\n`)

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*query-string key authorization or real model access/s)
  })
})

for (const queryKeyWording of [
  'search param key returns real model.',
  'query parameter key returns the real model.',
  'URL parameter key authorizes real model.',
  'query-string key returns the real model.',
  'key query string returns the real model.',
  'query string key authorizes access to the real model.',
  'query string key returns a real model.',
  'query string key returns `200` real model.',
  'query string key returns 200, real model.',
]) {
  test(`fails clearly when README documents ${queryKeyWording}`, async () => {
    await withFixture(async (fixtureRoot) => {
      const readmePath = join(fixtureRoot, 'README.md')
      const readme = await readFile(readmePath, 'utf8')
      await writeFile(readmePath, `${readme}\n${queryKeyWording}\n`)

      const result = await runCheck(fixtureRoot)
      assert.notEqual(result.exitCode, 0)
      assert.match(result.stderr, /README.md.*query-string key authorization or real model access/s)
    })
  })
}

test('does not reject query-string key denial wording as real model access', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(readmePath, `${readme}\n只提供 query string key，不返回真实模型；按缺少 Bearer token 处理。\n`)

    const result = await runCheck(fixtureRoot)
    assert.equal(result.exitCode, 0, result.stderr)
  })
})

test('does not reject query-string key English denial wording as real model access', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(
      readmePath,
      `${readme}\nquery string key cannot return the real model; treat it as missing Bearer token.\n`,
    )

    const result = await runCheck(fixtureRoot)
    assert.equal(result.exitCode, 0, result.stderr)
  })
})

for (const queryKeyDenialWording of [
  'must not return the real model; treat it as missing Bearer token.',
  'should not authorize the real model; treat it as missing Bearer token.',
  'never grants access to the real model; treat it as missing Bearer token.',
  'cannot grant access to the real model; treat it as missing Bearer token.',
  '不会授权真实模型；按缺少 Bearer token 处理',
  '不能返回真实模型；按缺少 Bearer token 处理',
  'can not authorize access to a real model; treat it as missing Bearer token.',
  'does not authorize access to a real model; treat it as missing Bearer token.',
]) {
  test(`accepts query-string key denial wording: ${queryKeyDenialWording}`, async () => {
    await withFixture(async (fixtureRoot) => {
      const readmePath = join(fixtureRoot, 'README.md')
      const readme = await readFile(readmePath, 'utf8')
      assert.ok(readme.includes('不授权真实模型；按缺少 Bearer token 处理'))
      await writeFile(readmePath, readme.replace('不授权真实模型；按缺少 Bearer token 处理', queryKeyDenialWording))

      const result = await runCheck(fixtureRoot)
      assert.equal(result.exitCode, 0, result.stderr)
    })
  })
}

for (const positiveGrantAccessWording of [
  'query string key grants access to the real model.',
  'query string key can grant access to the real model.',
  'query string key should grant access to the real model.',
]) {
  test(`fails clearly when README says ${positiveGrantAccessWording}`, async () => {
    await withFixture(async (fixtureRoot) => {
      const readmePath = join(fixtureRoot, 'README.md')
      const readme = await readFile(readmePath, 'utf8')
      await writeFile(readmePath, `${readme}\n${positiveGrantAccessWording}\n`)

      const result = await runCheck(fixtureRoot)
      assert.notEqual(result.exitCode, 0)
      assert.match(result.stderr, /README.md.*query-string key authorization or real model access/s)
    })
  })
}

test('fails when query-string key denial line also contains positive grant access claim', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(
      readmePath,
      `${readme}\nquery string key cannot grant access to the real model, but a debug ?key grants access to the real model.\n`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*query-string key authorization or real model access/s)
  })
})

for (const bearerContrastWording of [
  'query string key does not authorize the real model; Authorization: Bearer returns the real model.',
  'query string key does not authorize access to a real model, while Bearer token authorizes access to the real model.',
  'query string key does not authorize access to a real model, Authorization: Bearer returns the real model.',
]) {
  test(`accepts Bearer contrast wording: ${bearerContrastWording}`, async () => {
    await withFixture(async (fixtureRoot) => {
      const readmePath = join(fixtureRoot, 'README.md')
      const readme = await readFile(readmePath, 'utf8')
      await writeFile(readmePath, `${readme}\n${bearerContrastWording}\n`)

      const result = await runCheck(fixtureRoot)
      assert.equal(result.exitCode, 0, result.stderr)
    })
  })
}

test('fails clearly when README says query-string key authorizes the real model', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    assert.ok(readme.includes('不授权真实模型；按缺少 Bearer token 处理'))
    await writeFile(
      readmePath,
      readme.replace('不授权真实模型；按缺少 Bearer token 处理', '授权真实模型；返回 200 真实模型'),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*query-string key does not authorize the real model/s)
    assert.match(result.stderr, /README.md.*query-string key authorization or real model access/s)
  })
})

test('fails clearly when README 405 docs omit OPTIONS from the Allow header row', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    assert.ok(readme.includes('`405 Method Not Allowed`，`Allow: GET, HEAD, OPTIONS`'))
    await writeFile(
      readmePath,
      readme.replace(
        '`405 Method Not Allowed`，`Allow: GET, HEAD, OPTIONS`',
        '`405 Method Not Allowed`，`Allow: GET, HEAD`',
      ),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*405 docs must mention Allow: GET, HEAD, OPTIONS/s)
    assert.match(result.stderr, /README.md.*stale Allow: GET, HEAD semantics/s)
  })
})

test('fails clearly when README documents stale Model Worker cache-control semantics', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(readmePath, `${readme}\nStale example: Cache-Control: public, max-age=86400.\n`)

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*Cache-Control: public, max-age=86400/s)
  })
})

test('fails clearly when README selected R2 miss row omits Internal Server Error', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    const mutatedReadme = readme.replace(
      /^\|\s*选中的 R2 object 缺失\s*\|\s*`500 Internal Server Error`\s*\|$/m,
      '| 选中的 R2 object 缺失 | `404 Not Found` |',
    )
    assert.notEqual(mutatedReadme, readme, 'fixture should contain the selected R2 object missing row')
    await writeFile(readmePath, mutatedReadme)

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*selected R2 object missing docs must mention 500 Internal Server Error/s)
  })
})

const architectureGuardrailTerms = ['architecture:check', 'inferenceTimeoutConfig', 'StatusPanel', 'Model Worker Core']

for (const requiredTerm of architectureGuardrailTerms) {
  test(`fails clearly when README guardrails omit ${requiredTerm}`, async () => {
    await withFixture(async (fixtureRoot) => {
      const readmePath = join(fixtureRoot, 'README.md')
      const readme = await readFile(readmePath, 'utf8')
      assert.ok(readme.includes(requiredTerm), `fixture should mention ${requiredTerm}`)
      await writeFile(readmePath, readme.replaceAll(requiredTerm, 'omitted architecture guardrail'))

      const escapedTerm = requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const result = await runCheck(fixtureRoot)
      assert.notEqual(result.exitCode, 0)
      assert.match(result.stderr, new RegExp(`README\\.md.*${escapedTerm}`, 's'))
    })
  })
}
