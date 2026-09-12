import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')

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

function workflowJobBlock(source, name) {
  const lines = source.split(/\r?\n/)
  const start = lines.indexOf(`  ${name}:`)
  assert.notEqual(start, -1, `workflow job ${name} should exist`)
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/u.test(lines[index])) {
      end = index
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

function workflowStepBlock(source, name) {
  const lines = source.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`)
  assert.notEqual(start, -1, `workflow step ${name} should exist`)
  const indentation = lines[start].match(/^\s*/u)?.[0].length ?? 0
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if ((lines[index].match(/^\s*/u)?.[0].length ?? 0) === indentation && /^\s*-\s+/u.test(lines[index])) {
      end = index
      break
    }
  }
  return lines.slice(start, end).join('\n')
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
  const deployJob = workflowJobBlock(workflow, 'deploy')

  assert.match(deployJob, /^\s{4}if:\s*\$\{\{\s*github\.ref\s*==\s*'refs\/heads\/main'\s*\}\}\s*$/m)
  assert.match(deployJob, /^\s{4}environment:\s*production-model-worker\s*$/m)
  assert.match(
    workflow,
    /^\s+if:\s*\$\{\{[^\n]*inputs\.publish_model_worker[^\n]*github\.ref\s*==\s*'refs\/heads\/main'[^\n]*\}\}\s*$/m,
  )
})

test('secret-bearing repository jobs and steps are main-only with narrow secret scope', async () => {
  const workflow = await readFile(join(repoRoot, '.github', 'workflows', 'verify-monorepo.yml'), 'utf8')
  for (const name of [
    'extension-remote-authenticated-e2e',
    'extension-canonical-packaged-e2e',
    'extension-artifact',
    'extension-release',
  ]) {
    assert.match(workflowJobBlock(workflow, name), /github\.ref\s*==\s*'refs\/heads\/main'/u)
  }

  const canonicalJob = workflowJobBlock(workflow, 'extension-canonical-packaged-e2e')
  assert.doesNotMatch(canonicalJob, /^ {4}env:\s*$/mu)
  for (const stepName of ['Check canonical packaged-model configuration', 'Download and verify canonical model']) {
    const step = workflowStepBlock(canonicalJob, stepName)
    assert.match(step, /PACKAGED_MODEL_URL:/u)
    assert.match(step, /PACKAGED_MODEL_BEARER_TOKEN:/u)
    assert.match(step, /PACKAGED_MODEL_AUTH_REQUIRED:/u)
  }
  assert.match(
    workflowStepBlock(workflow, 'Validate canonical packaged-model configuration'),
    /github\.ref\s*==\s*'refs\/heads\/main'/u,
  )
})

for (const name of ['extension-artifact', 'extension-release']) {
  test(`${name} publication requires successful CodeQL analysis execution`, async () => {
    const workflow = await readFile(join(repoRoot, '.github', 'workflows', 'verify-monorepo.yml'), 'utf8')
    const job = workflowJobBlock(workflow, name)
    const needs = job.match(/^ {4}needs:\n(?<dependencies>(?: {6}- [A-Za-z0-9_-]+\n)+)/mu)?.groups?.dependencies
    assert.ok(needs, 'publication dependencies must be declared')
    assert.match(needs, /^ {6}- codeql$/mu)
    const condition = job.match(/^ {4}if: (?<condition>[^\n]+)$/mu)?.groups?.condition
    assert.ok(condition, 'publication condition must be declared')
    assert.match(condition, /&& needs\.codeql\.result == 'success' &&/u)
  })
}

test('repository jobs have bounded execution and superseded CI runs are cancelled', async () => {
  const workflow = await readFile(join(repoRoot, '.github', 'workflows', 'verify-monorepo.yml'), 'utf8')
  assert.match(
    workflow,
    /^concurrency:\n {2}group: repository-ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.event_name \}\}-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: \$\{\{ github\.event_name != 'workflow_dispatch' \}\}$/mu,
  )

  const jobsSource = workflow.slice(workflow.indexOf('\njobs:\n') + '\njobs:\n'.length)
  const jobNames = [...jobsSource.matchAll(/^ {2}(?<name>[A-Za-z0-9_-]+):\s*$/gmu)].map((match) => match.groups.name)
  assert.ok(jobNames.length > 0)
  for (const name of jobNames) {
    assert.match(workflowJobBlock(workflow, name), /^ {4}timeout-minutes:\s*[1-9][0-9]*\s*$/mu, `${name} must time out`)
  }

  const deployWorkflow = await readFile(
    join(repoRoot, '.github', 'workflows', 'deploy-cloudflare-model-worker.yml'),
    'utf8',
  )
  assert.match(workflowJobBlock(deployWorkflow, 'deploy'), /^ {4}timeout-minutes:\s*[1-9][0-9]*\s*$/mu)
})
