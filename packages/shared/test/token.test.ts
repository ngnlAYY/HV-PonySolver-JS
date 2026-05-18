import { describe, expect, it } from 'vitest'
import { isModelAccessToken } from '../src/token'

describe('isModelAccessToken', () => {
  it('accepts 64-character hexadecimal tokens', () => {
    expect(isModelAccessToken('a'.repeat(64))).toBe(true)
    expect(isModelAccessToken('A'.repeat(64))).toBe(true)
    expect(isModelAccessToken('0123456789abcdef'.repeat(4))).toBe(true)
  })

  it('rejects null, short, long, and non-hex tokens', () => {
    expect(isModelAccessToken(null)).toBe(false)
    expect(isModelAccessToken('a'.repeat(63))).toBe(false)
    expect(isModelAccessToken('a'.repeat(65))).toBe(false)
    expect(isModelAccessToken('g'.repeat(64))).toBe(false)
  })
})
