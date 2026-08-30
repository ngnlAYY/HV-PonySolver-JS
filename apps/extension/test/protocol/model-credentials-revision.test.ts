import { describe, expect, it } from 'vitest'

import { nextModelCredentialsRevision } from '../../src/protocol/model-credentials-revision'

describe('model credentials revision', () => {
  it('stays unique and monotonic when multiple updates share one clock tick', () => {
    const first = nextModelCredentialsRevision(1_234_567)
    const second = nextModelCredentialsRevision(1_234_567)

    expect(second).not.toBe(first)
    expect(Number.parseInt(second, 36)).toBeGreaterThan(Number.parseInt(first, 36))
  })
})
