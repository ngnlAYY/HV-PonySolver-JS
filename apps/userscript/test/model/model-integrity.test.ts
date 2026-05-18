import { afterEach, describe, expect, it, vi } from 'vitest'

import { verifyModelIntegrity } from '../../src/model/model-integrity'

const TEST_SHA256 = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'

function bufferFromBytes(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer
}

describe('verifyModelIntegrity', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('accepts a model buffer with matching byte length and SHA-256', async () => {
    await expect(verifyModelIntegrity(bufferFromBytes([1, 2, 3]), {
      byteLength: 3,
      sha256: TEST_SHA256,
    }, '模型'))
      .resolves.toBeUndefined()
  })

  it('rejects a model buffer with an unexpected byte length without hashing', async () => {
    const digest = vi.fn()
    vi.stubGlobal('crypto', { subtle: { digest } })

    await expect(verifyModelIntegrity(bufferFromBytes([1, 2, 3]), {
      byteLength: 4,
      sha256: TEST_SHA256,
    }, '下载模型'))
      .rejects.toThrow('下载模型大小校验失败')

    expect(digest).not.toHaveBeenCalled()
  })

  it('rejects a model buffer with an unexpected SHA-256', async () => {
    await expect(verifyModelIntegrity(bufferFromBytes([1, 2, 3]), {
      byteLength: 3,
      sha256: '0000000000000000000000000000000000000000000000000000000000000000',
    }, '缓存模型'))
      .rejects.toThrow('缓存模型 SHA-256 校验失败')
  })
})
