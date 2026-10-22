import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

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

function workflowStepScript(step) {
  const lines = step.split('\n')
  const start = lines.findIndex((line) => line.trim() === 'run: |')
  assert.notEqual(start, -1, 'workflow step must provide a shell script')
  const indentation = (lines[start].match(/^\s*/u)?.[0].length ?? 0) + 2
  return lines
    .slice(start + 1)
    .map((line) => line.slice(indentation))
    .join('\n')
}

async function runReleasePublication(t, initialState) {
  const root = await mkdtemp(join(tmpdir(), 'hv-release-tag-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const statePath = join(root, 'state.json')
  const fixturePath = join(root, 'gh.mjs')
  await writeFile(statePath, JSON.stringify(initialState))
  await writeFile(
    fixturePath,
    String.raw`
import { readFileSync, writeFileSync } from 'node:fs'
const statePath = process.env.RELEASE_TEST_STATE
const state = JSON.parse(readFileSync(statePath, 'utf8'))
const args = process.argv.slice(2)
const save = () => writeFileSync(statePath, JSON.stringify(state))
const fail = () => process.exit(1)
const value = (name) => args[args.indexOf(name) + 1]
if (args[0] === 'api') {
  if (state.apiFailure) fail()
  if (value('--method') !== 'POST') process.exit(state.tagCommit ? 0 : 1)
  if (!args.includes('/repos/' + process.env.GITHUB_REPOSITORY + '/git/refs')) fail()
  const fields = Object.fromEntries(args.flatMap((arg, index) => {
    if (!['--raw-field', '-f'].includes(arg)) return []
    const field = args[index + 1]
    const separator = field.indexOf('=')
    return [[field.slice(0, separator), field.slice(separator + 1)]]
  }))
  if (fields.ref !== 'refs/tags/' + process.env.RELEASE_TAG || !fields.sha || state.tagCommit) fail()
  state.tagCommit = fields.sha
  save()
} else if (args[0] === 'release' && args[1] === 'create') {
  state.releaseAttempted = true
  save()
  if (state.releaseFailure) fail()
  if (!state.tagCommit && args.includes('--verify-tag')) fail()
  state.tagCommit ??= value('--target')
  state.releaseCommit = state.tagCommit
  save()
} else fail()
`,
  )
  const workflow = await readFile(join(repoRoot, '.github', 'workflows', 'verify-monorepo.yml'), 'utf8')
  const script = workflowStepScript(workflowStepBlock(workflow, 'Publish GitHub Release'))
  const result = spawnSync(
    'bash',
    ['-e', '-o', 'pipefail', '-c', 'gh() { "$RELEASE_TEST_NODE" "$RELEASE_TEST_GH" "$@"; }\n' + script],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GH_TOKEN: '',
        GITHUB_REPOSITORY: 'fixture/extension',
        GITHUB_SHA: 'b'.repeat(40),
        RELEASE_TAG: 'extension-v0.1.1',
        RELEASE_VERSION: '0.1.1',
        RELEASE_TEST_NODE: process.execPath,
        RELEASE_TEST_GH: fixturePath,
        RELEASE_TEST_STATE: statePath,
      },
    },
  )
  return { result, state: JSON.parse(await readFile(statePath, 'utf8')) }
}

function workflowNeeds(job) {
  const dependencies = job.match(/^ {4}needs:\n(?<dependencies>(?: {6}- [A-Za-z0-9_-]+\n)+)/mu)?.groups?.dependencies
  assert.ok(dependencies, 'workflow dependencies must be explicit')
  return dependencies
    .trim()
    .split('\n')
    .map((line) => line.trim().slice(2))
}

function workflowJobNames(source) {
  const jobsStart = source.indexOf('\njobs:\n')
  assert.notEqual(jobsStart, -1, 'workflow jobs mapping should exist')
  return [...source.slice(jobsStart).matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gmu)].map((match) => match[1])
}

function conditionAllows(block, context, indentation = 8) {
  const expression = block.match(new RegExp(`^ {${indentation}}if: \\$\\{\\{ (.+) \\}\\}$`, 'mu'))?.[1]
  assert.ok(expression, 'workflow condition must be explicit')
  // Evaluate only the checked-in expression. GitHub adds success() when no
  // status function is present; model that rule so failed local steps block upload.
  const hasStatusFunction = /\b(?:always|cancelled|failure|success)\(/u.test(expression)
  if (!hasStatusFunction && context.currentJobSucceeded === false) return false
  return Boolean(
    runInNewContext(
      expression,
      {
        ...context,
        always: () => true,
        cancelled: () => context.cancelled === true,
        success: () => context.currentJobSucceeded !== false,
        failure: () => context.currentJobSucceeded === false,
      },
      { timeout: 1_000 },
    ),
  )
}

function publicationContext(dependencies, input) {
  return {
    github: { event_name: 'workflow_dispatch', ref: 'refs/heads/main' },
    vars: { RUN_CANONICAL_PACKAGED_GATE: 'true' },
    inputs: { publish_extension_artifact: false, publish_extension_release: false, [input]: true },
    needs: Object.fromEntries(dependencies.map((name) => [name, { result: 'success', outputs: { enabled: 'true' } }])),
    steps: {
      canonical_model_config: { outputs: { enabled: 'true' } },
      canonical_publication: { outputs: {} },
      canonical_release_gate: { outputs: {} },
    },
  }
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

test('every first extension ZIP upload waits for authorization and all required successful jobs', async () => {
  const workflow = await readFile(join(repoRoot, '.github', 'workflows', 'verify-monorepo.yml'), 'utf8')
  for (const [jobName, stepName, input] of [
    ['extension-e2e', 'Transfer tested remote extension packages to Release job', 'publish_extension_release'],
    ['extension-canonical-packaged-e2e', 'Authorize canonical product upload', 'publish_extension_artifact'],
  ]) {
    const job = workflowJobBlock(workflow, jobName)
    const dependencies = workflowNeeds(job)
    for (const required of [
      'guardrails',
      'codeql',
      'test',
      'coverage-build',
      'extension-packaged-e2e',
      'extension-minimum-versions-e2e',
      'extension-remote-authenticated-e2e',
      ...(jobName === 'extension-canonical-packaged-e2e' ? ['extension-e2e'] : []),
    ])
      assert.ok(dependencies.includes(required), `${jobName} must depend on ${required}`)
    const step = workflowStepBlock(job, stepName)
    const context = publicationContext(dependencies, input)
    assert.equal(conditionAllows(step, context), true, 'fully authorized successful publication should proceed')

    for (const event of ['push', 'pull_request']) {
      assert.equal(conditionAllows(step, { ...context, github: { ...context.github, event_name: event } }), false)
    }
    assert.equal(conditionAllows(step, { ...context, github: { ...context.github, ref: 'refs/heads/other' } }), false)
    assert.equal(conditionAllows(step, { ...context, inputs: { ...context.inputs, [input]: false } }), false)
    assert.equal(conditionAllows(step, { ...context, currentJobSucceeded: false }), false)
    for (const dependency of dependencies) {
      for (const result of ['failure', 'skipped', 'cancelled']) {
        const changed = globalThis.structuredClone(context)
        changed.needs[dependency].result = result
        assert.equal(conditionAllows(step, changed), false, `${jobName} must reject ${dependency}=${result}`)
      }
    }
    for (const enabled of ['false', undefined]) {
      const changed = globalThis.structuredClone(context)
      changed.needs['extension-remote-authenticated-e2e'].outputs.enabled = enabled
      assert.equal(conditionAllows(step, changed), false, 'a green but disabled protected smoke is insufficient')
    }
  }
})

test('canonical ZIPs stay local through Android validation and ordinary CI still runs without protected remote smoke', async () => {
  const workflow = await readFile(join(repoRoot, '.github', 'workflows', 'verify-monorepo.yml'), 'utf8')
  const canonical = workflowJobBlock(workflow, 'extension-canonical-packaged-e2e')
  const authorization = workflowStepBlock(canonical, 'Authorize canonical product upload')
  const android = workflowStepBlock(canonical, 'Download successful external Firefox Android 142 evidence')
  const preflight = workflowStepBlock(canonical, 'Fail-closed desktop and Firefox Android release preflight')
  const upload = workflowStepBlock(canonical, 'Transfer complete extension release gate')
  const context = publicationContext(workflowNeeds(canonical), 'publish_extension_artifact')

  assert.equal(canonical.match(/uses: actions\/upload-artifact@/gu)?.length, 1)
  assert.doesNotMatch(canonical, /uses: actions\/download-artifact@/u)
  assert.doesNotMatch(workflow, /hv-pony-solver-extension-canonical-gate|^ {2}firefox-android-142-release-gate:/mu)
  assert.match(canonical, /release_gate_passed: \$\{\{ steps\.canonical_release_gate\.outputs\.passed \}\}/u)
  assert.match(authorization, /id: canonical_publication/u)
  assert.match(authorization, /run: echo 'authorized=true' >> "\$GITHUB_OUTPUT"/u)
  assert.ok(
    canonical.indexOf('Firefox canonical packaged inference') < canonical.indexOf('Authorize canonical product upload'),
  )
  assert.ok(
    canonical.indexOf('Download successful external Firefox Android 142 evidence') <
      canonical.indexOf('Fail-closed desktop and Firefox Android release preflight'),
  )
  assert.ok(
    canonical.indexOf('Fail-closed desktop and Firefox Android release preflight') <
      canonical.indexOf('Transfer complete extension release gate'),
  )
  assert.match(preflight, /id: canonical_release_gate/u)
  assert.match(
    preflight,
    /node apps\/extension\/scripts\/release\/release-gate\.mjs preflight\n\s+echo 'passed=true' >> "\$GITHUB_OUTPUT"/u,
  )
  assert.match(upload, /apps\/extension\/dist\/\*\.zip/u)
  assert.equal(conditionAllows(android, context), false)
  assert.equal(conditionAllows(preflight, context), false)
  assert.equal(conditionAllows(upload, context), false)
  context.steps.canonical_publication.outputs.authorized = 'true'
  assert.equal(conditionAllows(android, context), true)
  assert.equal(conditionAllows(preflight, context), true)
  assert.equal(
    conditionAllows(upload, context),
    false,
    'authorization alone cannot upload before archive-bound preflight',
  )
  context.steps.canonical_release_gate.outputs.passed = 'true'
  assert.equal(conditionAllows(upload, context), true)
  assert.equal(conditionAllows(upload, { ...context, currentJobSucceeded: false }), false)
  context.steps.canonical_model_config.outputs.enabled = 'false'
  assert.equal(conditionAllows(authorization, context), false)

  for (const jobName of ['extension-e2e', 'extension-canonical-packaged-e2e']) {
    const job = workflowJobBlock(workflow, jobName)
    const ordinary = publicationContext(workflowNeeds(job), 'publish_extension_artifact')
    ordinary.github.event_name = 'push'
    ordinary.inputs.publish_extension_artifact = false
    ordinary.needs['extension-remote-authenticated-e2e'].result = 'skipped'
    ordinary.needs['extension-remote-authenticated-e2e'].outputs.enabled = undefined
    assert.equal(conditionAllows(job, ordinary, 4), true, `${jobName} should still validate ordinary main pushes`)
    assert.equal(conditionAllows(job, { ...ordinary, cancelled: true }, 4), false)
  }

  const finalJob = workflowJobBlock(workflow, 'extension-artifact')
  const finalContext = publicationContext(workflowNeeds(finalJob), 'publish_extension_artifact')
  assert.equal(conditionAllows(finalJob, finalContext, 4), false)
  finalContext.needs['extension-canonical-packaged-e2e'].outputs.release_gate_passed = 'true'
  assert.equal(conditionAllows(finalJob, finalContext, 4), true)
})

test('extension publication dependencies remain acyclic', async () => {
  const workflow = await readFile(join(repoRoot, '.github', 'workflows', 'verify-monorepo.yml'), 'utf8')
  const names = workflowJobNames(workflow)
  const visited = new Set()
  const active = new Set()
  const visit = (name) => {
    assert.ok(names.includes(name), `dependency ${name} must exist`)
    assert.equal(active.has(name), false, `dependency cycle reaches ${name}`)
    if (visited.has(name)) return
    active.add(name)
    const job = workflowJobBlock(workflow, name)
    const singleNeed = job.match(/^ {4}needs: ([A-Za-z0-9_-]+)$/mu)?.[1]
    const dependencies = singleNeed ? [singleNeed] : /^ {4}needs:/mu.test(job) ? workflowNeeds(job) : []
    for (const dependency of dependencies) visit(dependency)
    active.delete(name)
    visited.add(name)
  }
  for (const name of names) visit(name)
})

test('all complete extension ZIP uploads belong to the guarded publication flow', async () => {
  const workflow = await readFile(join(repoRoot, '.github', 'workflows', 'verify-monorepo.yml'), 'utf8')
  const uploads = []
  for (const name of workflowJobNames(workflow)) {
    for (const step of workflowJobBlock(workflow, name)
      .split(/\n {6}- name: /u)
      .slice(1)) {
      if (/uses: actions\/upload-artifact@/u.test(step) && /apps\/extension\/dist\/\*\.zip/u.test(step)) {
        uploads.push([name, step.split('\n')[0]])
      }
    }
  }
  assert.deepEqual(uploads, [
    ['extension-e2e', 'Transfer tested remote extension packages to Release job'],
    ['extension-canonical-packaged-e2e', 'Transfer complete extension release gate'],
    ['extension-artifact', 'Publish extension artifacts'],
  ])
})

test('the verification job table matches the current Repository CI jobs', async () => {
  const [workflow, documentation] = await Promise.all([
    readFile(join(repoRoot, '.github', 'workflows', 'verify-monorepo.yml'), 'utf8'),
    readFile(join(repoRoot, 'docs', 'development', 'verification.md'), 'utf8'),
  ])
  const section = documentation.split('## CI job 与本地命令\n')[1]?.split('\n## ')[0]
  assert.ok(section, 'verification guide must document Repository CI jobs')
  const documented = [...section.matchAll(/^\|\s*([A-Za-z0-9][A-Za-z0-9_-]*)\s*\|/gmu)]
    .map((match) => match[1])
    .filter((name) => name !== 'job')
  assert.deepEqual(documented.sort(), workflowJobNames(workflow).sort())
})

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

test('release publication binds the new tag and release to the verified commit', async (t) => {
  const { result, state } = await runReleasePublication(t, {})
  assert.equal(result.status, 0, result.stderr)
  assert.equal(state.tagCommit, 'b'.repeat(40))
  assert.equal(state.releaseCommit, 'b'.repeat(40))
})

for (const [label, apiFailure] of [
  ['an existing tag', false],
  ['a failed GitHub API request', true],
]) {
  test(`release publication stops on ${label} without publishing against the old commit`, async (t) => {
    const oldCommit = 'a'.repeat(40)
    const { result, state } = await runReleasePublication(t, { tagCommit: oldCommit, apiFailure })
    assert.notEqual(result.status, 0)
    assert.equal(state.tagCommit, oldCommit)
    assert.equal(state.releaseAttempted, undefined)
    assert.equal(state.releaseCommit, undefined)
  })
}

test('a failed release creation preserves the newly bound tag for manual recovery', async (t) => {
  const { result, state } = await runReleasePublication(t, { releaseFailure: true })
  assert.notEqual(result.status, 0)
  assert.equal(state.tagCommit, 'b'.repeat(40))
  assert.equal(state.releaseCommit, undefined)
})
