import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function checkoutStepBlocks(source) {
  const lines = source.split(/\r?\n/)
  const blocks = []
  for (let start = 0; start < lines.length; start += 1) {
    if (!lines[start].includes('uses: actions/checkout@')) continue
    const actionIndent = lines[start].match(/^\s*/)?.[0].length ?? 0
    let stepStart = start
    while (stepStart > 0 && !/^\s*-\s+/.test(lines[stepStart])) stepStart -= 1
    const stepIndent = lines[stepStart].match(/^\s*/)?.[0].length ?? Math.max(0, actionIndent - 2)
    let end = lines.length
    for (let index = start + 1; index < lines.length; index += 1) {
      const indent = lines[index].match(/^\s*/)?.[0].length ?? 0
      if (indent === stepIndent && /^\s*-\s+/.test(lines[index])) {
        end = index
        break
      }
    }
    blocks.push(lines.slice(stepStart, end).join('\n'))
  }
  return blocks
}

test('every checkout step disables persisted GitHub credentials', async () => {
  const sources = await Promise.all(
    ['verify-monorepo.yml', 'deploy-cloudflare-model-worker.yml'].map((name) =>
      readFile(join(repoRoot, '.github', 'workflows', name), 'utf8'),
    ),
  )
  const blocks = sources.flatMap(checkoutStepBlocks)

  assert.ok(blocks.length > 0)
  for (const block of blocks) {
    assert.match(block, /\bpersist-credentials:\s*false\b/)
  }
})

test('production Model Worker deployment is main-only and uses the protected environment', async () => {
  const workflow = await readFile(join(repoRoot, '.github', 'workflows', 'deploy-cloudflare-model-worker.yml'), 'utf8')

  assert.match(workflow, /^\s{4}environment:\s*production-model-worker\s*$/m)
  assert.match(
    workflow,
    /^\s+if:\s*\$\{\{[^\n]*inputs\.publish_model_worker[^\n]*github\.ref\s*==\s*'refs\/heads\/main'[^\n]*\}\}\s*$/m,
  )
})
