import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveFetchImplementation } from '../../src/platform/fetch'

describe('resolveFetchImplementation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the global receiver for the default browser fetch', async () => {
    const response = new Response('default')
    const fetchMock = vi.fn(function (this: typeof globalThis): Promise<Response> {
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation')
      }
      return Promise.resolve(response)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(resolveFetchImplementation()('https://example.test/')).resolves.toBe(response)
  })

  it('also protects an explicitly supplied native fetch reference', async () => {
    const response = new Response('injected')
    const fetchMock = vi.fn(function (this: typeof globalThis): Promise<Response> {
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation')
      }
      return Promise.resolve(response)
    })

    await expect(resolveFetchImplementation(fetchMock)('https://example.test/')).resolves.toBe(response)
  })
})
