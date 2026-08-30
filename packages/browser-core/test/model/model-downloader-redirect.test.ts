import { describe, expect, it, vi } from 'vitest'

import { MODEL_DOWNLOAD_RECEIPT_HEADER } from '@hv-pony-solver/shared'
import {
  confirmCachedModelDownload,
  downloadModel,
  probeModelAccessKey,
  queryModelDownloadQuota,
} from '../../src/model/model-downloader'

const TEST_BYTES = new Uint8Array([1, 2, 3])
const TEST_INTEGRITY = {
  byteLength: TEST_BYTES.byteLength,
  sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
} as const
const RECEIPT_ID = '0123456789abcdef0123456789abcdef'

describe('model downloader redirect policy', () => {
  it('rejects redirects for download, quota, probe, and confirmation requests', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(TEST_BYTES, {
          headers: {
            'content-length': String(TEST_BYTES.byteLength),
            [MODEL_DOWNLOAD_RECEIPT_HEADER]: RECEIPT_ID,
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ enabled: false, limit: 0, used: 0, remaining: null, retryAfterSeconds: null }),
      )
      .mockResolvedValueOnce(new Response(null, { headers: { 'content-length': String(TEST_BYTES.byteLength) } }))
      .mockResolvedValueOnce(Response.json({ confirmed: true }))
    const environment = { fetchImpl: fetchMock, getAccessKey: async () => 'saved-token' }

    const buffer = await downloadModel(undefined, { integrity: TEST_INTEGRITY }, environment)
    await queryModelDownloadQuota(undefined, { integrity: TEST_INTEGRITY }, environment)
    await probeModelAccessKey(undefined, { integrity: TEST_INTEGRITY }, environment)
    await confirmCachedModelDownload(buffer)

    expect(fetchMock).toHaveBeenCalledTimes(4)
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.redirect).toBe('error')
    }
  })
})
