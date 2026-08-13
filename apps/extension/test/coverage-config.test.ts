import { describe, expect, it } from 'vitest'

import config from '../vitest.config'

const criticalFiles = [
  'src/background/broker.ts',
  'src/content/remote-detector-client.ts',
  'src/host/indexeddb-string-storage.ts',
  'src/host/inference-host.ts',
  'src/options/remote.ts',
] as const

describe('coverage configuration', () => {
  it('includes every production source and enforces global and critical-file floors', () => {
    const coverage = config.test?.coverage
    expect(coverage?.include).toEqual(['src/**/*.ts'])
    expect(coverage?.thresholds).toMatchObject({
      statements: 81,
      branches: 78,
      functions: 76,
      lines: 82,
    })
    const thresholds = coverage?.thresholds as Record<string, unknown> | undefined
    for (const file of criticalFiles) {
      expect(thresholds?.[file]).toEqual({
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      })
    }
  })
})
