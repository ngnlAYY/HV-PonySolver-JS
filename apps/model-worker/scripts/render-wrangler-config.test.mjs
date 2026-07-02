import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, cp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const scriptDir = dirname(fileURLToPath(import.meta.url))
const workerDir = resolve(scriptDir, '..')
const validKvNamespaceId = '0123456789abcdef0123456789abcdef'
const validBucketName = 'bucket-prod'

async function withTempWorker(callback) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'hv-pony-worker-config-'))
  const tempWorkerDir = join(tempRoot, 'model-worker')

  try {
    await cp(workerDir, tempWorkerDir, {
      recursive: true,
      filter: (source) => !source.includes('/node_modules/') && !source.includes('/coverage/'),
    })
    return await callback(tempWorkerDir)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

async function runRender(env, prepare) {
  return withTempWorker(async (tempWorkerDir) => {
    await prepare?.(tempWorkerDir)
    const scriptPath = join(tempWorkerDir, 'scripts/render-wrangler-config.mjs')
    const result = await execFileAsync(process.execPath, [scriptPath], {
      cwd: tempWorkerDir,
      env: {
        PATH: process.env.PATH,
        ...env,
      },
    })

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      wrangler: await readFile(join(tempWorkerDir, 'wrangler.toml'), 'utf8'),
    }
  })
}

async function runValidate(wranglerConfig) {
  return withTempWorker(async (tempWorkerDir) => {
    await writeFile(join(tempWorkerDir, 'wrangler.toml'), wranglerConfig)
    const scriptPath = join(tempWorkerDir, 'scripts/validate-wrangler-config.mjs')
    return execFileAsync(process.execPath, [scriptPath], { cwd: tempWorkerDir })
  })
}

async function runModelWorkerVitest(env) {
  return execFileAsync('corepack', ['pnpm', 'exec', 'vitest', 'run', 'test/env.test.ts'], {
    cwd: workerDir,
    env: {
      ...process.env,
      ...env,
    },
  })
}

function stripAnsi(value) {
  const escape = String.fromCharCode(27)
  return value
    .split(escape)
    .map((segment, index) => (index === 0 ? segment : segment.replace(/^\[[0-?]*[ -/]*[@-~]/u, '')))
    .join('')
}

test('renderWranglerConfigFile writes generated test config from the template', async () => {
  const { renderWranglerConfigFile, testWranglerConfigEnv } = await import('./wrangler-config-renderer.mjs')

  await withTempWorker(async (tempWorkerDir) => {
    const outputPath = join(tempWorkerDir, '.wrangler/vitest/wrangler.toml')
    const rendered = await renderWranglerConfigFile({
      templatePath: join(tempWorkerDir, 'wrangler.template.toml'),
      outputPath,
      values: testWranglerConfigEnv,
      outputName: 'apps/model-worker/.wrangler/vitest/wrangler.toml',
    })

    assert.equal(rendered, await readFile(outputPath, 'utf8'))
    assert.match(rendered, /main = "src\/index\.ts"/)
    assert.match(rendered, /INVALID_KEY_MODE = "decoy"/)
    assert.match(rendered, /id = "test-kv"/)
    assert.match(rendered, /bucket_name = "test-bucket"/)
  })
})

test('renderWranglerConfigFile escapes custom main paths as TOML strings', async () => {
  const { renderWranglerConfigFile, testWranglerConfigEnv } = await import('./wrangler-config-renderer.mjs')

  await withTempWorker(async (tempWorkerDir) => {
    const outputPath = join(tempWorkerDir, '.wrangler/vitest/wrangler.toml')
    const rendered = await renderWranglerConfigFile({
      templatePath: join(tempWorkerDir, 'wrangler.template.toml'),
      outputPath,
      values: testWranglerConfigEnv,
      mainPath: 'C:\\worker\\src\\index.ts',
    })

    assert.match(rendered, /main = "C:\\\\worker\\\\src\\\\index\.ts"/)
  })
})

test('renderWranglerConfig defaults INVALID_KEY_MODE to decoy', async () => {
  const { renderWranglerConfig, testWranglerConfigEnv } = await import('./wrangler-config-renderer.mjs')

  const template = 'INVALID_KEY_MODE = "${INVALID_KEY_MODE}"\nid = "${MODEL_KEYS_KV_NAMESPACE_ID}"\nbucket_name = "${MODEL_BUCKET_NAME}"\n'
  const rendered = renderWranglerConfig(template, { values: testWranglerConfigEnv })

  assert.match(rendered, /INVALID_KEY_MODE = "decoy"/)
})

test('renderWranglerConfig accepts INVALID_KEY_MODE error', async () => {
  const { renderWranglerConfig, testWranglerConfigEnv } = await import('./wrangler-config-renderer.mjs')

  const template = 'INVALID_KEY_MODE = "${INVALID_KEY_MODE}"\nid = "${MODEL_KEYS_KV_NAMESPACE_ID}"\nbucket_name = "${MODEL_BUCKET_NAME}"\n'
  const rendered = renderWranglerConfig(template, {
    values: { ...testWranglerConfigEnv, INVALID_KEY_MODE: 'error' },
  })

  assert.match(rendered, /INVALID_KEY_MODE = "error"/)
})

test('renderWranglerConfig rejects unsupported INVALID_KEY_MODE values', async () => {
  const { renderWranglerConfig, testWranglerConfigEnv } = await import('./wrangler-config-renderer.mjs')

  const template = 'INVALID_KEY_MODE = "${INVALID_KEY_MODE}"\nid = "${MODEL_KEYS_KV_NAMESPACE_ID}"\nbucket_name = "${MODEL_BUCKET_NAME}"\n'

  assert.throws(
    () => renderWranglerConfig(template, { values: { ...testWranglerConfigEnv, INVALID_KEY_MODE: 'allow' } }),
    /INVALID_KEY_MODE must be one of: decoy, error/,
  )
})

test('render-wrangler-config renders test placeholders outside production mode', async () => {
  const result = await runRender({
    MODEL_KEYS_KV_NAMESPACE_ID: 'test-kv',
    MODEL_BUCKET_NAME: 'test-bucket',
  })

  assert.match(result.wrangler, /INVALID_KEY_MODE = "decoy"/)
  assert.match(result.wrangler, /id = "test-kv"/)
  assert.match(result.wrangler, /bucket_name = "test-bucket"/)
})

test('render-wrangler-config renders INVALID_KEY_MODE error from env', async () => {
  const result = await runRender({
    MODEL_KEYS_KV_NAMESPACE_ID: 'test-kv',
    MODEL_BUCKET_NAME: 'test-bucket',
    INVALID_KEY_MODE: 'error',
  })

  assert.match(result.wrangler, /INVALID_KEY_MODE = "error"/)
})

test('model-worker vitest config keeps test placeholders isolated from deploy render mode', async () => {
  const result = await runModelWorkerVitest({ HV_PONY_SOLVER_RENDER_ENV: 'deploy' })
  const stdout = stripAnsi(result.stdout)

  assert.match(stdout, /Test Files\s+1 passed/)
  assert.match(stdout, /Tests\s+5 passed/)
})

test('render-wrangler-config requires MODEL_KEYS_KV_NAMESPACE_ID', async () => {
  await assert.rejects(runRender({ MODEL_BUCKET_NAME: validBucketName }), /MODEL_KEYS_KV_NAMESPACE_ID is required/)
})

test('render-wrangler-config requires MODEL_BUCKET_NAME', async () => {
  await assert.rejects(runRender({ MODEL_KEYS_KV_NAMESPACE_ID: validKvNamespaceId }), /MODEL_BUCKET_NAME is required/)
})

test('render-wrangler-config rejects test placeholders in production mode', async () => {
  await assert.rejects(
    runRender({
      MODEL_KEYS_KV_NAMESPACE_ID: 'test-kv',
      MODEL_BUCKET_NAME: validBucketName,
      HV_PONY_SOLVER_RENDER_ENV: 'production',
    }),
    /MODEL_KEYS_KV_NAMESPACE_ID must not use test placeholder value in production mode/,
  )
})

test('render-wrangler-config rejects test placeholders in deploy mode', async () => {
  await assert.rejects(
    runRender({
      MODEL_KEYS_KV_NAMESPACE_ID: validKvNamespaceId,
      MODEL_BUCKET_NAME: 'test-bucket',
      HV_PONY_SOLVER_RENDER_ENV: 'deploy',
    }),
    /MODEL_BUCKET_NAME must not use test placeholder value in production mode/,
  )
})

test('render-wrangler-config rejects invalid KV namespace ids', async () => {
  await assert.rejects(
    runRender({ MODEL_KEYS_KV_NAMESPACE_ID: 'kv-prod', MODEL_BUCKET_NAME: validBucketName }),
    /MODEL_KEYS_KV_NAMESPACE_ID must be 32 位小写十六进制字符/,
  )
})

test('render-wrangler-config rejects unsafe characters in KV namespace ids', async () => {
  await assert.rejects(
    runRender({ MODEL_KEYS_KV_NAMESPACE_ID: `${validKvNamespaceId}"`, MODEL_BUCKET_NAME: validBucketName }),
    /MODEL_KEYS_KV_NAMESPACE_ID must not contain quotes or backslashes/,
  )
})

test('render-wrangler-config rejects invalid bucket names', async () => {
  await assert.rejects(
    runRender({ MODEL_KEYS_KV_NAMESPACE_ID: validKvNamespaceId, MODEL_BUCKET_NAME: 'Bucket-Prod' }),
    /MODEL_BUCKET_NAME must be 3-63 位小写字母、数字或连字符，且首尾为字母或数字/,
  )
})

test('render-wrangler-config rejects control characters in bucket names', async () => {
  await assert.rejects(
    runRender({ MODEL_KEYS_KV_NAMESPACE_ID: validKvNamespaceId, MODEL_BUCKET_NAME: 'bucket\nprod' }),
    /MODEL_BUCKET_NAME must not contain control characters/,
  )
})

test('render-wrangler-config rejects unresolved placeholders after rendering', async () => {
  await assert.rejects(
    runRender(
      { MODEL_KEYS_KV_NAMESPACE_ID: validKvNamespaceId, MODEL_BUCKET_NAME: validBucketName },
      async (tempWorkerDir) => {
        const templatePath = join(tempWorkerDir, 'wrangler.template.toml')
        const template = await readFile(templatePath, 'utf8')
        await writeFile(templatePath, `${template}\nUNKNOWN = "${'${UNKNOWN_PLACEHOLDER}'}"\n`)
      },
    ),
    /apps\/model-worker\/wrangler\.toml contains unresolved placeholder \$\{UNKNOWN_PLACEHOLDER}/,
  )
})

test('validate-wrangler-config accepts valid rendered config before deploy', async () => {
  await runValidate(
    `[[kv_namespaces]]\nbinding = "MODEL_KEYS"\nid = "${validKvNamespaceId}"\n[[r2_buckets]]\nbinding = "MODEL_BUCKET"\nbucket_name = "${validBucketName}"\n`,
  )
})

test('validate-wrangler-config rejects stale test placeholders before deploy', async () => {
  await assert.rejects(
    runValidate('id = "test-kv"\nbucket_name = "bucket-prod"\n'),
    /MODEL_KEYS_KV_NAMESPACE_ID must not use test placeholder value in production mode/,
  )
})

test('validate-wrangler-config rejects unresolved placeholders before deploy', async () => {
  await assert.rejects(
    runValidate(`id = "${validKvNamespaceId}"\nbucket_name = "${'${MODEL_BUCKET_NAME}'}"\n`),
    /wrangler\.toml contains unresolved placeholder \$\{MODEL_BUCKET_NAME}/,
  )
})

test('validate-wrangler-config rejects invalid rendered values before deploy', async () => {
  await assert.rejects(
    runValidate(`id = "${validKvNamespaceId}"\nbucket_name = "Bucket-Prod"\n`),
    /MODEL_BUCKET_NAME must be 3-63 位小写字母、数字或连字符，且首尾为字母或数字/,
  )
})

test('validate-wrangler-config rejects wrong MODEL_KEYS binding names before deploy', async () => {
  await assert.rejects(
    runValidate(`[[kv_namespaces]]\nbinding = "MODEL_KEY"\nid = "${validKvNamespaceId}"\n[[r2_buckets]]\nbinding = "MODEL_BUCKET"\nbucket_name = "${validBucketName}"\n`),
    /wrangler\.toml kv_namespaces must contain binding = "MODEL_KEYS" with id/,
  )
})

test('validate-wrangler-config rejects swapped KV and bucket binding sections before deploy', async () => {
  await assert.rejects(
    runValidate(`[[kv_namespaces]]\nbinding = "MODEL_BUCKET"\nid = "${validKvNamespaceId}"\n[[r2_buckets]]\nbinding = "MODEL_KEYS"\nbucket_name = "${validBucketName}"\n`),
    /wrangler\.toml kv_namespaces must contain binding = "MODEL_KEYS" with id/,
  )
})

test('validate-wrangler-config rejects bindings declared outside resource sections before deploy', async () => {
  await assert.rejects(
    runValidate(`id = "${validKvNamespaceId}"\nbucket_name = "${validBucketName}"\n[[unsafe.metadata]]\nbinding = "MODEL_KEYS"\nbinding = "MODEL_BUCKET"\n`),
    /wrangler\.toml kv_namespaces must contain binding = "MODEL_KEYS" with id/,
  )
})

test('validate-wrangler-config rejects unsupported INVALID_KEY_MODE values before deploy', async () => {
  await assert.rejects(
    runValidate(`INVALID_KEY_MODE = "allow"\nid = "${validKvNamespaceId}"\nbucket_name = "${validBucketName}"\nbinding = "MODEL_KEYS"\nbinding = "MODEL_BUCKET"\n`),
    /wrangler\.toml INVALID_KEY_MODE must be one of: decoy, error/,
  )
})

test('validate-wrangler-config rejects malformed TOML assignments before deploy', async () => {
  await assert.rejects(
    runValidate(`id = "${validKvNamespaceId}"unexpected\nbucket_name = "${validBucketName}"\n`),
    /wrangler\.toml id must be a quoted TOML string without extra content/,
  )
})

test('validate-wrangler-config rejects duplicate KV namespace assignments before deploy', async () => {
  await assert.rejects(
    runValidate(`id = "${validKvNamespaceId}"\nid = "fedcba9876543210fedcba9876543210"\nbucket_name = "${validBucketName}"\n`),
    /wrangler\.toml must contain exactly one id/,
  )
})

test('validate-wrangler-config rejects duplicate bucket assignments before deploy', async () => {
  await assert.rejects(
    runValidate(`id = "${validKvNamespaceId}"\nbucket_name = "${validBucketName}"\nbucket_name = "other-bucket"\n`),
    /wrangler\.toml must contain exactly one bucket_name/,
  )
})

test('validate-wrangler-config rejects duplicate KV namespace assignments without required spaces', async () => {
  await assert.rejects(
    runValidate(`id="${validKvNamespaceId}"\nid = "fedcba9876543210fedcba9876543210"\nbucket_name = "${validBucketName}"\n`),
    /wrangler\.toml must contain exactly one id/,
  )
})

test('validate-wrangler-config rejects duplicate bucket assignments with tab spacing', async () => {
  await assert.rejects(
    runValidate(`id = "${validKvNamespaceId}"\nbucket_name\t= "${validBucketName}"\nbucket_name = "other-bucket"\n`),
    /wrangler\.toml must contain exactly one bucket_name/,
  )
})
