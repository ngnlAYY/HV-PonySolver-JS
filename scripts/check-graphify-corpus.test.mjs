import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { checkGraphifyCorpus } from './check-graphify-corpus.mjs'

async function createRepo() {
  return mkdtemp(join(tmpdir(), 'graphify-corpus-'))
}

describe('checkGraphifyCorpus', () => {
  it('accepts a repo that contains every required graphify ignore entry', async () => {
    const repoRoot = await createRepo()
    await writeFile(join(repoRoot, '.graphifyignore'), [
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
    ].join('\n'))

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

  it('rejects graph reports that still contain generated GitNexus markers', async () => {
    const repoRoot = await createRepo()
    await writeFile(join(repoRoot, '.graphifyignore'), [
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
    ].join('\n'))
    await mkdir(join(repoRoot, 'graphify-out'))
    await writeFile(join(repoRoot, 'graphify-out', 'GRAPH_REPORT.md'), 'God node: fileHashes from .gitnexus/meta.json\n')
    await writeFile(join(repoRoot, 'graphify-out', 'graph.json'), JSON.stringify({
      nodes: [
        { id: 'fileHashes', label: 'fileHashes', source_file: '.gitnexus/meta.json' },
      ],
    }))

    await assert.rejects(
      checkGraphifyCorpus(repoRoot, { report: true }),
      /Graphify report contains generated-artifact marker: \.gitnexus\//,
    )
  })
})
