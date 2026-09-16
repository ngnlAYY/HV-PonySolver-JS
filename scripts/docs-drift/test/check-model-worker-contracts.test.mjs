import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import {
  packageManagerVersion,
  repoRoot,
  readFile,
  runCheck,
  runCliCheck,
  withFixture,
  writeFile,
} from './fixtures.mjs'

test('current repository README is in sync with source facts through the CLI', async () => {
  const result = await runCliCheck(repoRoot)
  assert.equal(result.exitCode, 0, result.stderr)
  assert.match(result.stdout, /Docs drift check passed/)
})

test('fails clearly when Model Worker ops docs omit the secretless dry-run skip contract', async () => {
  await withFixture(async (fixtureRoot) => {
    const opsDocPath = join(fixtureRoot, 'docs/model-worker-ops.md')
    const opsDoc = await readFile(opsDocPath, 'utf8')
    assert.ok(opsDoc.includes('Cloudflare secrets 不完整且 `publish_model_worker=false` 时会安全跳过'))
    await writeFile(
      opsDocPath,
      opsDoc.replace(
        'Cloudflare secrets 不完整且 `publish_model_worker=false` 时会安全跳过',
        'Cloudflare secrets 不完整且 `publish_model_worker=false` 时仍会执行',
      ),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /docs\/model-worker-ops\.md.*secrets.*dry-run/s)
  })
})

test('fails clearly when the Model Worker secret gate accepts whitespace-only values', async () => {
  await withFixture(async (fixtureRoot) => {
    const workflowPath = join(fixtureRoot, '.github/workflows/deploy-cloudflare-model-worker.yml')
    let workflow = await readFile(workflowPath, 'utf8')
    for (const variable of [
      'CLOUDFLARE_ACCOUNT_ID',
      'CLOUDFLARE_API_TOKEN',
      'MODEL_KEYS_KV_NAMESPACE_ID',
      'MODEL_BUCKET_NAME',
    ]) {
      workflow = workflow.replaceAll(`"\${${variable}//[[:space:]]/}"`, `"$${variable}"`)
    }
    await writeFile(workflowPath, workflow)

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /whitespace-only.*secrets/s)
  })
})

test('fails clearly when a duplicate workflow step masks an ungated deployment step', async () => {
  await withFixture(async (fixtureRoot) => {
    const workflowPath = join(fixtureRoot, '.github/workflows/deploy-cloudflare-model-worker.yml')
    const workflow = await readFile(workflowPath, 'utf8')
    const canonicalStep = `      - name: Render Wrangler config
        if: \${{ steps.cloudflare_secrets.outputs.ready == 'true' }}`
    const ungatedStep = `      - name: Render Wrangler config
        if: \${{ always() }}`
    assert.ok(workflow.includes(canonicalStep))
    const driftedWorkflow = workflow.replace(canonicalStep, ungatedStep).replace(
      ungatedStep,
      `${canonicalStep}
        run: echo "decoy"

${ungatedStep}`,
    )
    await writeFile(workflowPath, driftedWorkflow)

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /exactly one.*Render Wrangler config/s)
  })
})

test('fails clearly when Model Worker deployment is not bound to the production environment', async () => {
  await withFixture(async (fixtureRoot) => {
    const workflowPath = join(fixtureRoot, '.github/workflows/deploy-cloudflare-model-worker.yml')
    const workflow = (await readFile(workflowPath, 'utf8')).replace(
      'environment: production-model-worker',
      'environment: staging-model-worker',
    )
    await writeFile(workflowPath, workflow)

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /production-model-worker environment/s)
  })
})

test('fails clearly when Model Worker deployment is not restricted to main', async () => {
  await withFixture(async (fixtureRoot) => {
    const workflowPath = join(fixtureRoot, '.github/workflows/deploy-cloudflare-model-worker.yml')
    const workflow = await readFile(workflowPath, 'utf8')
    await writeFile(
      workflowPath,
      workflow.replace("github.ref == 'refs/heads/main'", "github.ref != 'refs/heads/main'"),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /deployment.*refs\/heads\/main/s)
  })
})

test('does not let a later workflow job mask a missing deployment branch gate', async () => {
  await withFixture(async (fixtureRoot) => {
    const workflowPath = join(fixtureRoot, '.github/workflows/deploy-cloudflare-model-worker.yml')
    const workflow = await readFile(workflowPath, 'utf8')
    const driftedWorkflow = workflow.replace(
      "inputs.publish_model_worker && github.ref == 'refs/heads/main' && steps.cloudflare_secrets.outputs.ready == 'true'",
      "inputs.publish_model_worker && steps.cloudflare_secrets.outputs.ready == 'true'",
    )
    assert.notEqual(driftedWorkflow, workflow, 'fixture should contain the deployment main-branch gate')
    await writeFile(
      workflowPath,
      `${driftedWorkflow}\n  decoy:\n    if: \${{ github.ref == 'refs/heads/main' }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /deployment.*refs\/heads\/main/s)
  })
})

for (const command of [
  'mise.toml',
  'mise install',
  'mise exec -- pnpm install --frozen-lockfile',
  'mise exec -- pnpm check',
]) {
  test(`fails clearly when command reference omits mise setup entry ${command}`, async () => {
    await withFixture(async (fixtureRoot) => {
      const readmePath = join(fixtureRoot, 'docs/development/commands.md')
      await writeFile(readmePath, (await readFile(readmePath, 'utf8')).replaceAll(command, 'missing-toolchain-entry'))

      const result = await runCheck(fixtureRoot)
      assert.notEqual(result.exitCode, 0)
      assert.match(result.stderr, /docs\/development\/commands\.md mise setup must document/u)
    })
  })
}

for (const [documentedVersion, replacement, errorPattern] of [
  ['24.15.0', '24.14.0', /docs\/development\/commands\.md.*Node.*24\.15\.0/s],
  [packageManagerVersion, '0.0.0', /docs\/development\/commands\.md.*pnpm/s],
]) {
  test(`fails clearly when command reference drifts from runtime requirement ${documentedVersion}`, async () => {
    await withFixture(async (fixtureRoot) => {
      const readmePath = join(fixtureRoot, 'docs/development/commands.md')
      await writeFile(readmePath, (await readFile(readmePath, 'utf8')).replaceAll(documentedVersion, replacement))

      const result = await runCheck(fixtureRoot)
      assert.notEqual(result.exitCode, 0)
      assert.match(result.stderr, errorPattern)
    })
  })
}

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

// command reference 文档契约：这些测试验证 command reference 是否准确描述脚本、模型、ONNX Runtime 和 Model Worker 的当前事实。
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
  test(`fails clearly when command reference omits ${commandName} from pnpm check description`, async () => {
    await withFixture(async (fixtureRoot) => {
      const readmePath = join(fixtureRoot, 'docs/development/commands.md')
      const readme = await readFile(readmePath, 'utf8')
      assert.ok(readme.includes(commandName), `fixture should mention ${commandName}`)
      await writeFile(readmePath, readme.replaceAll(commandName, 'omitted check command'))

      const escapedCommandName = commandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const result = await runCheck(fixtureRoot)
      assert.notEqual(result.exitCode, 0)
      assert.match(result.stderr, new RegExp(`docs/development/commands\\.md.*pnpm check.*${escapedCommandName}`, 's'))
    })
  })
}
