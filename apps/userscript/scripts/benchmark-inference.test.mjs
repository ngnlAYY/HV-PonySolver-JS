import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

// Exercise the unchanged CLI in an isolated app with a deterministic build barrier, not real model work.
const fakeBuild = `
import { writeFile } from 'node:fs/promises'
export async function build({ outfile }) {
  await writeFile(outfile, \`
    export const imagePreprocessConfig = { imageSize: 2 }
    export const yoloOutputConfig = { rowSize: 6, confidenceIndex: 4, classIndex: 5 }
    export const copyRgbaToChwFloat32 = () => {}
    export const parseYoloOutputTensor = () => []
  \`)
  process.send({ outfile })
  if (process.env.BENCH_TEST_WAIT === '1') await new Promise(resolve => process.once('message', resolve))
  if (process.env.BENCH_TEST_FAIL === '1') throw new Error('fixture build failed')
}
`

function launch(script, environment) {
  const child = fork(script, [], {
    execArgv: [],
    env: { ...process.env, BENCH_TEST_WAIT: '0', BENCH_TEST_FAIL: '0', ...environment },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    timeout: 10_000,
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  const finished = new Promise((resolve) => {
    child.once('close', (code) => resolve({ code, stdout, stderr }))
    child.once('error', (error) => resolve({ code: null, stdout, stderr: error.message }))
  })
  const ready = new Promise((resolve, reject) => {
    child.once('message', resolve)
    child.once('error', reject)
    child.once('close', () => reject(new Error('benchmark closed before the build barrier')))
  })
  return { child, ready, finished }
}

for (const secondFails of [false, true]) {
  test(
    `concurrent benchmark cleanup remains isolated when the other build ${secondFails ? 'fails' : 'succeeds'}`,
    { timeout: 20_000 },
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'hv-inference-benchmark-'))
      const children = []
      try {
        const script = join(root, 'scripts/benchmark-inference.mjs')
        const fakePackage = join(root, 'node_modules/esbuild')
        await mkdir(dirname(script), { recursive: true })
        await mkdir(fakePackage, { recursive: true })
        await copyFile(new globalThis.URL('./benchmark-inference.mjs', import.meta.url), script)
        await writeFile(join(fakePackage, 'package.json'), JSON.stringify({ type: 'module', exports: './index.mjs' }))
        await writeFile(join(fakePackage, 'index.mjs'), fakeBuild)
        await mkdir(join(root, '.tmp/keep'), { recursive: true })

        const first = launch(script, { BENCH_TEST_WAIT: '1' })
        children.push(first)
        const firstBuild = await first.ready
        const second = launch(script, { BENCH_TEST_FAIL: secondFails ? '1' : '0' })
        children.push(second)
        const [secondBuild, secondResult] = await Promise.all([second.ready, second.finished])
        assert.equal(secondResult.code, secondFails ? 1 : 0, secondResult.stderr)
        assert.notEqual(dirname(firstBuild.outfile), dirname(secondBuild.outfile))
        assert.match(await readFile(firstBuild.outfile, 'utf8'), /export const imagePreprocessConfig/u)
        first.child.send('continue')
        const firstResult = await first.finished
        assert.equal(firstResult.code, 0, firstResult.stderr)
        assert.match(firstResult.stdout, /parseYoloOutputTensor:.*ms\/op/u)
        assert.deepEqual(await readdir(join(root, '.tmp')), ['keep'])
      } finally {
        for (const { child } of children) {
          if (child.exitCode === null && child.signalCode === null) child.kill()
        }
        await Promise.all(children.map(({ finished }) => finished))
        await rm(root, { recursive: true, force: true })
      }
    },
  )
}
