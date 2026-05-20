import { describe, expect, it } from 'vitest'

import { createCachedModelRow, readCachedModelBuffer } from '../../src/model/model-cache'
import { modelConfig } from '../../src/model/model-config'

const TEST_SHA256 = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'
const TEST_INTEGRITY = { byteLength: 3, sha256: TEST_SHA256 } as const

function bufferFromBytes(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer
}

describe('readCachedModelBuffer', () => {
  it('returns cached buffers without integrity checks by default', async () => {
    const buffer = bufferFromBytes([9, 9, 9])

    await expect(readCachedModelBuffer({
      key: modelConfig.cacheKey,
      version: modelConfig.version,
      byteLength: 1,
      sha256: '0000000000000000000000000000000000000000000000000000000000000000',
      buffer,
    }, TEST_INTEGRITY))
      .resolves.toBe(buffer)
  })

  it('returns cached buffers that match the configured integrity when verification is enabled', async () => {
    const buffer = bufferFromBytes([1, 2, 3])

    await expect(readCachedModelBuffer({
      key: modelConfig.cacheKey,
      version: modelConfig.version,
      byteLength: TEST_INTEGRITY.byteLength,
      sha256: TEST_INTEGRITY.sha256,
      buffer,
    }, TEST_INTEGRITY, true))
      .resolves.toBe(buffer)
  })

  it('ignores cached buffers with mismatched integrity when verification is enabled', async () => {
    await expect(readCachedModelBuffer({
      key: modelConfig.cacheKey,
      version: modelConfig.version,
      byteLength: 1,
      sha256: TEST_INTEGRITY.sha256,
      buffer: bufferFromBytes([9]),
    }, TEST_INTEGRITY, true))
      .resolves.toBeNull()
  })

  it('ignores cached buffers with forged integrity metadata when verification is enabled', async () => {
    await expect(readCachedModelBuffer({
      key: modelConfig.cacheKey,
      version: modelConfig.version,
      byteLength: TEST_INTEGRITY.byteLength,
      sha256: TEST_INTEGRITY.sha256,
      buffer: bufferFromBytes([9, 9, 9]),
    }, TEST_INTEGRITY, true))
      .resolves.toBeNull()
  })
})

describe('createCachedModelRow', () => {
  it('creates cache rows without integrity checks by default', async () => {
    await expect(createCachedModelRow(bufferFromBytes([9, 9, 9]), TEST_INTEGRITY))
      .resolves.toMatchObject({
        key: modelConfig.cacheKey,
        version: modelConfig.version,
        byteLength: TEST_INTEGRITY.byteLength,
        sha256: TEST_INTEGRITY.sha256,
      })
  })

  it('creates cache rows only for buffers that pass integrity verification when verification is enabled', async () => {
    await expect(createCachedModelRow(bufferFromBytes([1, 2, 3]), TEST_INTEGRITY, true))
      .resolves.toMatchObject({
        key: modelConfig.cacheKey,
        version: modelConfig.version,
        byteLength: TEST_INTEGRITY.byteLength,
        sha256: TEST_INTEGRITY.sha256,
      })
  })

  it('rejects cache rows for buffers with unexpected integrity when verification is enabled', async () => {
    await expect(createCachedModelRow(bufferFromBytes([9, 9, 9]), TEST_INTEGRITY, true))
      .rejects.toThrow('缓存写入模型 SHA-256 校验失败')
  })
})
