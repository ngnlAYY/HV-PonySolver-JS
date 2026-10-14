import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { URL } from 'node:url'

test('full check runs both test layers once while preserving every quick-check gate', async () => {
  const { scripts } = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(scripts.test, 'pnpm -r test && pnpm test:root')
  assert.equal(scripts['test:coverage'], 'pnpm -r test:coverage')
  assert.equal(scripts['test:root'], 'node --test "scripts/**/*.test.mjs"')

  const quickSteps = scripts['check:quick'].split(' && ')
  assert.equal(quickSteps.filter((step) => step === 'pnpm test').length, 1)
  // 覆盖率阶段已执行工作区 Vitest 和包内 Node 用例；根级 Node 必须另跑，不能漏掉。
  const fullSteps = quickSteps.flatMap((step) =>
    step === 'pnpm test' ? ['pnpm test:coverage', 'pnpm test:root'] : [step],
  )
  assert.deepEqual(scripts.check.split(' && '), [...fullSteps, 'pnpm build'])
})
