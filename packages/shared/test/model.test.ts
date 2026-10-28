import { describe, expect, it } from 'vitest'

import { normalizeModelDownloadReceiptId } from '../src/model'

describe('normalizeModelDownloadReceiptId', () => {
  it('normalizes model download receipt IDs through one shared contract', () => {
    expect(normalizeModelDownloadReceiptId(`  ${'A'.repeat(32)}  `)).toBe('a'.repeat(32))
    expect(normalizeModelDownloadReceiptId('a'.repeat(31))).toBeNull()
    expect(normalizeModelDownloadReceiptId('g'.repeat(32))).toBeNull()
    expect(normalizeModelDownloadReceiptId(null)).toBeNull()
  })
})
