import { describe, expect, it } from 'vitest'

import { USERSCRIPT_METADATA } from '../src/userscript/metadata'

describe('USERSCRIPT_METADATA', () => {
  it('matches only HTTPS HentaiVerse pages', () => {
    expect(USERSCRIPT_METADATA).toContain('// @include     https://hentaiverse.org/*')
    expect(USERSCRIPT_METADATA).toContain('// @include     https://alt.hentaiverse.org/*')
    expect(USERSCRIPT_METADATA).not.toContain('http*://')
    expect(USERSCRIPT_METADATA).not.toContain('http://')
  })
})
