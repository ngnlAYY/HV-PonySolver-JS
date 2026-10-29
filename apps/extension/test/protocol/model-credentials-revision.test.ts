import { describe, expect, it } from 'vitest'

import { nextModelCredentialsRevision } from '../../src/protocol/model-credentials-revision'

describe('model credentials revision', () => {
  it('issues distinct revision tokens for consecutive commits', () => {
    const first = nextModelCredentialsRevision()
    const second = nextModelCredentialsRevision()

    expect(second).not.toBe(first)
  })
})
