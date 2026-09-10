import { describe, expect, it } from 'vitest'
import { getModelAccessTokenLookupKeys, isModelAccessToken, normalizeModelAccessToken } from '../src/token'

const TEST_HEX_BLOCK = Array.from({ length: 16 }, (_, index) => index.toString(16)).join('')
const TEST_DECIMAL_BLOCK = Array.from({ length: 10 }, (_, index) => String(index)).join('')
const LOWERCASE_TOKEN = TEST_HEX_BLOCK.repeat(4)
const UPPERCASE_TOKEN = LOWERCASE_TOKEN.toUpperCase()
const NUMERIC_TOKEN = TEST_DECIMAL_BLOCK.repeat(6) + TEST_DECIMAL_BLOCK.slice(0, 4)
const MIXED_CASE_TOKEN = [
  TEST_HEX_BLOCK,
  TEST_HEX_BLOCK.toUpperCase(),
  TEST_HEX_BLOCK,
  TEST_HEX_BLOCK.toUpperCase(),
].join('')

describe('isModelAccessToken', () => {
  it('accepts 64-character hexadecimal tokens', () => {
    expect(isModelAccessToken('a'.repeat(64))).toBe(true)
    expect(isModelAccessToken('A'.repeat(64))).toBe(true)
    expect(isModelAccessToken(LOWERCASE_TOKEN)).toBe(true)
  })

  it('rejects null, short, long, and non-hex tokens', () => {
    expect(isModelAccessToken(null)).toBe(false)
    expect(isModelAccessToken('a'.repeat(63))).toBe(false)
    expect(isModelAccessToken('a'.repeat(65))).toBe(false)
    expect(isModelAccessToken('g'.repeat(64))).toBe(false)
  })
})

describe('normalizeModelAccessToken', () => {
  it('returns lowercase canonical tokens for valid 64-character hex values', () => {
    expect(normalizeModelAccessToken(LOWERCASE_TOKEN)).toBe(LOWERCASE_TOKEN)
    expect(normalizeModelAccessToken(UPPERCASE_TOKEN)).toBe(LOWERCASE_TOKEN)
    expect(normalizeModelAccessToken(MIXED_CASE_TOKEN)).toBe(MIXED_CASE_TOKEN.toLowerCase())
  })

  it('trims surrounding whitespace before normalization', () => {
    expect(normalizeModelAccessToken(` \n${UPPERCASE_TOKEN}\t `)).toBe(LOWERCASE_TOKEN)
  })

  it('returns null for missing, empty, short, long, and non-hex values', () => {
    expect(normalizeModelAccessToken(null)).toBeNull()
    expect(normalizeModelAccessToken(undefined)).toBeNull()
    expect(normalizeModelAccessToken('')).toBeNull()
    expect(normalizeModelAccessToken('   ')).toBeNull()
    expect(normalizeModelAccessToken('a'.repeat(63))).toBeNull()
    expect(normalizeModelAccessToken('a'.repeat(65))).toBeNull()
    expect(normalizeModelAccessToken('g'.repeat(64))).toBeNull()
  })
})

describe('getModelAccessTokenLookupKeys', () => {
  it('returns only the canonical key when uppercase fallback is identical', () => {
    expect(getModelAccessTokenLookupKeys(NUMERIC_TOKEN)).toEqual([NUMERIC_TOKEN])
  })

  it('returns canonical lowercase first and uppercase fallback for uppercase historical KV keys', () => {
    expect(getModelAccessTokenLookupKeys(LOWERCASE_TOKEN)).toEqual([LOWERCASE_TOKEN, UPPERCASE_TOKEN])
    expect(getModelAccessTokenLookupKeys(UPPERCASE_TOKEN)).toEqual([LOWERCASE_TOKEN, UPPERCASE_TOKEN])
  })

  it('returns canonical lowercase first, original key, and uppercase fallback for mixed-case input', () => {
    expect(getModelAccessTokenLookupKeys(MIXED_CASE_TOKEN)).toEqual([
      MIXED_CASE_TOKEN.toLowerCase(),
      MIXED_CASE_TOKEN,
      MIXED_CASE_TOKEN.toUpperCase(),
    ])
  })

  it('returns no lookup keys for invalid values', () => {
    expect(getModelAccessTokenLookupKeys(null)).toEqual([])
    expect(getModelAccessTokenLookupKeys(undefined)).toEqual([])
    expect(getModelAccessTokenLookupKeys('not-a-token')).toEqual([])
  })
})
