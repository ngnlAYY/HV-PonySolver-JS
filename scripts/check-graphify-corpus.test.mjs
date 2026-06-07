import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { checkGraphifyCorpus } from './check-graphify-corpus.mjs'

const completeGraphifyIgnore = [
  '.gitnexus/',
  'graphify-out/',
  '.codegraph/',
  '.code-review-graph',
  'docs/superpowers/',
  '.claude/',
  'node_modules/',
  '**/node_modules/',
  '**/dist/',
  '**/coverage/',
  '.pnpm-store/',
  'apps/userscript/.tmp/',
  '',
].join('\n')

async function createRepo() {
  return mkdtemp(join(tmpdir(), 'graphify-corpus-'))
}

async function writeCompleteGraphifyIgnore(repoRoot) {
  await writeFile(join(repoRoot, '.graphifyignore'), completeGraphifyIgnore)
}

async function writeGraphifyOutput(repoRoot, report, graph) {
  await mkdir(join(repoRoot, 'graphify-out'))
  await writeFile(join(repoRoot, 'graphify-out', 'GRAPH_REPORT.md'), report)
  await writeFile(join(repoRoot, 'graphify-out', 'graph.json'), JSON.stringify(graph))
}

describe('checkGraphifyCorpus', () => {
  it('accepts a repo that contains every required graphify ignore entry', async () => {
    const repoRoot = await createRepo()
    await writeCompleteGraphifyIgnore(repoRoot)

    await assert.doesNotReject(checkGraphifyCorpus(repoRoot))
  })

  it('accepts default checks when graphify output files are absent', async () => {
    const repoRoot = await createRepo()
    await writeCompleteGraphifyIgnore(repoRoot)

    await assert.doesNotReject(checkGraphifyCorpus(repoRoot))
  })

  it('rejects a repo that does not ignore GitNexus generated files', async () => {
    const repoRoot = await createRepo()
    await writeFile(join(repoRoot, '.graphifyignore'), 'graphify-out/\n')

    await assert.rejects(
      checkGraphifyCorpus(repoRoot),
      /\.graphifyignore is missing required entry: \.gitnexus\//,
    )
  })

  it('rejects graph reports by default when generated GitNexus markers are present', async () => {
    const repoRoot = await createRepo()
    await writeCompleteGraphifyIgnore(repoRoot)
    await writeGraphifyOutput(repoRoot, 'God node: fileHashes from .gitnexus/meta.json\n', {
      nodes: [
        { id: 'fileHashes', label: 'fileHashes', source_file: '.gitnexus/meta.json' },
      ],
    })

    await assert.rejects(
      checkGraphifyCorpus(repoRoot),
      /Graphify report contains generated-artifact marker: \.gitnexus\//,
    )
  })

  it('rejects graph reports that still contain generated GitNexus markers when report validation is forced', async () => {
    const repoRoot = await createRepo()
    await writeCompleteGraphifyIgnore(repoRoot)
    await writeGraphifyOutput(repoRoot, 'God node: fileHashes from .gitnexus/meta.json\n', {
      nodes: [
        { id: 'fileHashes', label: 'fileHashes', source_file: '.gitnexus/meta.json' },
      ],
    })

    await assert.rejects(
      checkGraphifyCorpus(repoRoot, { report: true }),
      /Graphify report contains generated-artifact marker: \.gitnexus\//,
    )
  })

  it('rejects graph JSON nodes with absolute GitNexus source paths', async () => {
    const repoRoot = await createRepo()
    await writeCompleteGraphifyIgnore(repoRoot)
    await writeGraphifyOutput(repoRoot, 'Clean graph report\n', {
      nodes: [
        { source_file: '/home/example/repo/.gitnexus/meta.json' },
      ],
    })

    await assert.rejects(
      checkGraphifyCorpus(repoRoot),
      /Graphify graph contains generated-artifact node: \/home\/example\/repo\/\.gitnexus\/meta\.json/,
    )
  })

  it('rejects graph JSON nodes with Windows-style GitNexus source paths', async () => {
    const repoRoot = await createRepo()
    await writeCompleteGraphifyIgnore(repoRoot)
    await writeGraphifyOutput(repoRoot, 'Clean graph report\n', {
      nodes: [
        { source_file: 'C:\\repo\\.gitnexus\\meta.json' },
      ],
    })

    await assert.rejects(
      checkGraphifyCorpus(repoRoot),
      /Graphify graph contains generated-artifact node: C:\/repo\/\.gitnexus\/meta\.json/,
    )
  })
})
