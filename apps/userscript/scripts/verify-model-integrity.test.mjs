import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

const appDir = resolve(import.meta.dirname, '..')
const sourceScriptPath = resolve(appDir, 'scripts/verify-model-integrity.mjs')

test('verify-model-integrity CLI exits 0 for a matching model and canonical manifest', async () => {
  const fixture = await createCliFixture()
  try {
    const bytes = Buffer.from([1, 2, 3])
    const modelPath = join(fixture.root, 'yolo26n-640.onnx')
    await writeCanonicalManifest(fixture.root, bytes)
    await writeFile(modelPath, bytes)

    const result = await runCli(sourceScriptPath, {
      ...process.env,
      MODEL_FILE: modelPath,
    }, ['--repo-root', fixture.root])

    assert.equal(result.code, 0)
    assert.match(result.stdout, /Model integrity verified/)
    assert.match(result.stdout, /byteLength=3/)
    assert.equal(result.stderr, '')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('verify-model-integrity CLI exits 1 for a mismatched model and canonical manifest', async () => {
  const fixture = await createCliFixture()
  try {
    const modelPath = join(fixture.root, 'yolo26n-640.onnx')
    await writeCanonicalManifest(fixture.root, Buffer.from([1, 2, 3]))
    await writeFile(modelPath, Buffer.from([4, 5]))

    const result = await runCli(sourceScriptPath, {
      ...process.env,
      MODEL_FILE: modelPath,
    }, ['--repo-root', fixture.root])

    assert.equal(result.code, 1)
    assert.match(result.stderr, /Model integrity mismatch/)
    assert.match(result.stderr, /Expected: byteLength: 3/)
    assert.match(result.stderr, /Actual: byteLength: 2/)
    assert.match(result.stderr, /sha256:/)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('verify-model-integrity CLI accepts numeric separators in canonical byteLength', async () => {
  const fixture = await createCliFixture()
  try {
    const bytes = Buffer.alloc(1234, 7)
    const modelPath = join(fixture.root, 'yolo26n-640.onnx')
    await writeCanonicalManifestSource(fixture.root, '1_234', bytes)
    await writeFile(modelPath, bytes)

    const result = await runCli(sourceScriptPath, {
      ...process.env,
      MODEL_FILE: modelPath,
    }, ['--repo-root', fixture.root])

    assert.equal(result.code, 0)
    assert.match(result.stdout, /Model integrity verified/)
    assert.match(result.stdout, /byteLength=1234/)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('verify-model-integrity CLI exits 1 when MODEL_FILE is missing through the default repo root branch', async () => {
  const result = await runCli(sourceScriptPath, withoutModelFile(process.env))

  assert.equal(result.code, 1)
  assert.match(result.stderr, /MODEL_FILE is required/)
})

test('verify-model-integrity CLI reads the default canonical manifest when MODEL_FILE exists', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'hv-pony-model-integrity-default-'))
  try {
    const modelPath = join(tempDir, 'mismatched.onnx')
    await writeFile(modelPath, Buffer.from([1, 2, 3]))
    const expectedByteLength = await readCanonicalByteLength()

    const result = await runCli(sourceScriptPath, withoutManifestOverride({
      ...process.env,
      MODEL_FILE: modelPath,
    }))

    assert.equal(result.code, 1)
    assert.match(result.stderr, /Model integrity mismatch/)
    assert.match(result.stderr, new RegExp(`Expected: byteLength: ${expectedByteLength}\\b`))
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('verify-model-integrity does not call process.exit after writing mismatch errors', async () => {
  const source = await readFile(sourceScriptPath, 'utf8')

  assert.doesNotMatch(source, /writeError\([\s\S]*?process\.exit\(1\)/)
  assert.match(source, /process\.exitCode\s*=\s*1/)
})

test('verify-model-integrity CLI ignores manifest path environment overrides', async () => {
  const fixture = await createCliFixture()
  try {
    const modelBytes = Buffer.from([4, 5])
    const modelPath = join(fixture.root, 'yolo26n-640.onnx')
    const overrideManifestPath = join(fixture.root, 'override/model.ts')
    await writeCanonicalManifest(fixture.root, Buffer.from([1, 2, 3]))
    await writeManifest(overrideManifestPath, modelBytes)
    await writeFile(modelPath, modelBytes)

    const result = await runCli(sourceScriptPath, {
      ...process.env,
      MODEL_FILE: modelPath,
      HV_PONY_SOLVER_MODEL_MANIFEST_PATH: overrideManifestPath,
    }, ['--repo-root', fixture.root])

    assert.equal(result.code, 1)
    assert.match(result.stderr, /Model integrity mismatch/)
    assert.match(result.stderr, /Expected: byteLength: 3/)
    assert.match(result.stderr, /Actual: byteLength: 2/)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

async function createCliFixture() {
  const root = await mkdtemp(join(tmpdir(), 'hv-pony-model-integrity-'))
  return { root }
}

async function writeCanonicalManifest(root, bytes) {
  await writeManifest(join(root, 'packages/shared/src/model.ts'), bytes)
}

async function writeCanonicalManifestSource(root, byteLengthSource, bytes) {
  const manifestPath = join(root, 'packages/shared/src/model.ts')
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, `export const MODEL_INTEGRITY = { byteLength: ${byteLengthSource}, sha256: '${sha256(bytes)}' } as const\n`)
}

async function writeManifest(manifestPath, bytes) {
  const integrity = {
    byteLength: bytes.byteLength,
    sha256: sha256(bytes),
  }
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, `export const MODEL_INTEGRITY = ${JSON.stringify(integrity)} as const\n`)
}

async function readCanonicalByteLength() {
  const source = await readFile(resolve(appDir, '../../packages/shared/src/model.ts'), 'utf8')
  const match = source.match(/byteLength:\s*([0-9_]+)/)
  assert.ok(match?.[1], 'expected packages/shared/src/model.ts to define MODEL_INTEGRITY.byteLength')
  return Number(match[1].replaceAll('_', ''))
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function runCli(scriptPath, env, args = []) {
  return new Promise((resolveRun) => {
    execFile(process.execPath, [scriptPath, ...args], { cwd: dirname(scriptPath), env }, (error, stdout, stderr) => {
      resolveRun({
        code: error && typeof error.code === 'number' ? error.code : 0,
        stdout,
        stderr,
      })
    })
  })
}

function withoutManifestOverride(env) {
  const rest = { ...env }
  delete rest.HV_PONY_SOLVER_MODEL_MANIFEST_PATH
  return rest
}

function withoutModelFile(env) {
  const rest = withoutManifestOverride(env)
  delete rest.MODEL_FILE
  return rest
}
