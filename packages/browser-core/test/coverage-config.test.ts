import { describe, expect, it } from 'vitest'

import config from '../vitest.config'

const criticalFiles = [
  'src/app/app.ts',
  'src/captcha/answer-submitter.ts',
  'src/captcha/captcha-solver.ts',
  'src/inference/onnx-worker-client.ts',
  'src/model/model-cache.ts',
  'src/model/model-downloader.ts',
] as const

describe('coverage configuration', () => {
  it('includes every production source and enforces global and critical-file floors', () => {
    const coverage = config.test?.coverage
    expect(coverage?.include).toEqual(['src/**/*.ts'])
    expect(coverage?.thresholds).toMatchObject({
      statements: 72,
      branches: 64,
      functions: 68,
      lines: 72,
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
