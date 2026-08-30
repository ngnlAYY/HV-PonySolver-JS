import { describe, expect, it } from 'vitest'

import { hasExpectedR2ObjectIntegrity } from '../src/asset-integrity'

const expected = { byteLength: 3, sha256: 'a'.repeat(64) }

function object(size: number, sha256?: string) {
  return {
    size,
    checksums: {
      toJSON: () => (sha256 === undefined ? {} : { sha256 }),
    },
  }
}

describe('hasExpectedR2ObjectIntegrity', () => {
  it('requires the canonical byte length', () => {
    expect(hasExpectedR2ObjectIntegrity(object(2), expected)).toBe(false)
  })

  it('rejects a mismatched R2 SHA-256 when the checksum is available', () => {
    expect(hasExpectedR2ObjectIntegrity(object(3, 'b'.repeat(64)), expected)).toBe(false)
  })

  it('accepts exact size with either a matching or unavailable R2 SHA-256', () => {
    expect(hasExpectedR2ObjectIntegrity(object(3), expected)).toBe(true)
    expect(hasExpectedR2ObjectIntegrity(object(3, expected.sha256.toUpperCase()), expected)).toBe(true)
  })

  it('fails closed when R2 checksum metadata cannot be read', () => {
    expect(
      hasExpectedR2ObjectIntegrity(
        {
          size: expected.byteLength,
          checksums: {
            toJSON: () => {
              throw new Error('checksum metadata unavailable')
            },
          },
        },
        expected,
      ),
    ).toBe(false)
  })
})
