import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { readFile, runCheck, withFixture, writeFile } from './fixtures.mjs'

test('fails clearly when the Model Worker probe example uses a shell placeholder', async () => {
  await withFixture(async (fixtureRoot) => {
    const opsDocPath = join(fixtureRoot, 'docs/model-worker-ops.md')
    const opsDoc = await readFile(opsDocPath, 'utf8')
    const placeholder = 'MODEL_WORKER_PROBE_ID=<probe-id>'
    await writeFile(
      opsDocPath,
      opsDoc.includes(placeholder) ? opsDoc : opsDoc.replace('MODEL_WORKER_PROBE_ID=manual-$(date +%s)', placeholder),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /docs\/model-worker-ops\.md.*MODEL_WORKER_PROBE_ID.*executable/s)
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
        .replaceAll('externalFullRuntime.byteLength', 'external full runtime byte length')
        .replaceAll('externalFullRuntime.sha256', 'external full runtime sha256')
        .replaceAll('externalFullRuntime.maxByteLength', 'external full runtime max byte length')
        .replaceAll('externalFullRuntime.mjsByteLength', 'external full runtime MJS byte length')
        .replaceAll('externalFullRuntime.mjsSha256', 'external full runtime MJS sha256')
        .replaceAll('externalFullRuntime.mjsMaxByteLength', 'external full runtime MJS max byte length')
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
    assert.match(result.stderr, /README.md.*externalFullRuntime\.byteLength/s)
    assert.match(result.stderr, /README.md.*externalFullRuntime\.sha256/s)
    assert.match(result.stderr, /README.md.*externalFullRuntime\.maxByteLength/s)
    assert.match(result.stderr, /README.md.*externalFullRuntime\.mjsByteLength/s)
    assert.match(result.stderr, /README.md.*externalFullRuntime\.mjsSha256/s)
    assert.match(result.stderr, /README.md.*externalFullRuntime\.mjsMaxByteLength/s)
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

test('fails clearly when ONNX Runtime docs omit the external JSEP MJS contract and lifecycle', async () => {
  await withFixture(async (fixtureRoot) => {
    const runtimeDocPath = join(fixtureRoot, 'docs/onnx-runtime.md')
    const runtimeDoc = await readFile(runtimeDocPath, 'utf8')
    await writeFile(
      runtimeDocPath,
      runtimeDoc
        .replaceAll(
          'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort-wasm-simd-threaded.jsep.mjs',
          'https://cdn.example/ort.jsep.mjs',
        )
        .replaceAll('externalFullRuntime.mjsSha256', 'external full runtime MJS hash')
        .replaceAll('wasmPaths', 'WASM paths')
        .replaceAll('onFirstSessionInitSettled', 'first session init cleanup'),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /docs\/onnx-runtime\.md.*ort-wasm-simd-threaded\.jsep\.mjs/s)
    assert.match(result.stderr, /docs\/onnx-runtime\.md.*externalFullRuntime\.mjsSha256/s)
    assert.match(result.stderr, /docs\/onnx-runtime\.md.*wasmPaths/s)
    assert.match(result.stderr, /docs\/onnx-runtime\.md.*onFirstSessionInitSettled/s)
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
