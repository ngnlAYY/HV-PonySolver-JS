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

async function runRender(env) {
  return withTempWorker(async (tempWorkerDir) => {
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

test('render-wrangler-config renders test placeholders outside production mode', async () => {
  const result = await runRender({
    MODEL_KEYS_KV_NAMESPACE_ID: 'test-kv',
    MODEL_BUCKET_NAME: 'test-bucket',
  })

  assert.match(result.wrangler, /id = "test-kv"/)
  assert.match(result.wrangler, /bucket_name = "test-bucket"/)
})

test('render-wrangler-config requires MODEL_KEYS_KV_NAMESPACE_ID', async () => {
  await assert.rejects(runRender({ MODEL_BUCKET_NAME: 'bucket-prod' }), /MODEL_KEYS_KV_NAMESPACE_ID is required/)
})

test('render-wrangler-config rejects test placeholders in production mode', async () => {
  await assert.rejects(
    runRender({
      MODEL_KEYS_KV_NAMESPACE_ID: 'test-kv',
      MODEL_BUCKET_NAME: 'bucket-prod',
      HV_PONY_SOLVER_RENDER_ENV: 'production',
    }),
    /MODEL_KEYS_KV_NAMESPACE_ID must not use test placeholder value in production mode/,
  )
})

test('render-wrangler-config rejects test placeholders in deploy mode', async () => {
  await assert.rejects(
    runRender({
      MODEL_KEYS_KV_NAMESPACE_ID: 'kv-prod',
      MODEL_BUCKET_NAME: 'test-bucket',
      HV_PONY_SOLVER_RENDER_ENV: 'deploy',
    }),
    /MODEL_BUCKET_NAME must not use test placeholder value in production mode/,
  )
})

test('validate-wrangler-config rejects stale test placeholders before deploy', async () => {
  await assert.rejects(
    withTempWorker(async (tempWorkerDir) => {
      await writeFile(join(tempWorkerDir, 'wrangler.toml'), 'id = "test-kv"\nbucket_name = "bucket-prod"\n')
      const scriptPath = join(tempWorkerDir, 'scripts/validate-wrangler-config.mjs')
      await execFileAsync(process.execPath, [scriptPath], { cwd: tempWorkerDir })
    }),
    /wrangler.toml must not contain test placeholder value: test-kv/,
  )
})
