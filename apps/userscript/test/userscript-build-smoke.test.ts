import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const outputPath = resolve(import.meta.dirname, '../dist/hv-pony-solver.user.js')

describe('userscript build output', () => {
  it('contains metadata, bootstrap, and worker script injection markers', async () => {
    const output = await readFile(outputPath, 'utf8')

    expect(output).toContain('// ==UserScript==')
    expect(output).toContain('// @name        HV-PonySolver-Local')
    expect(output).toContain('HV-PonySolver')
    expect(output).toContain('__HV_PONY_SOLVER_WORKER_RUNTIME_SOURCE_PLACEHOLDER__')
    expect(output).toContain('DOMContentLoaded')
  })
})
