import { describe, expect, it } from 'vitest'

import { USERSCRIPT_METADATA, USERSCRIPT_VERSION_PLACEHOLDER } from '../src/userscript/metadata'

describe('USERSCRIPT_METADATA', () => {
  it('matches only HTTPS HentaiVerse pages', () => {
    expect(USERSCRIPT_METADATA).toContain('// @include     https://hentaiverse.org/*')
    expect(USERSCRIPT_METADATA).toContain('// @include     https://alt.hentaiverse.org/*')
    expect(USERSCRIPT_METADATA).not.toContain('http*://')
    expect(USERSCRIPT_METADATA).not.toContain('http://')
  })

  it('declares the version through the build-time placeholder', () => {
    expect(USERSCRIPT_METADATA).toContain(`// @version     ${USERSCRIPT_VERSION_PLACEHOLDER}`)
    // The published version lives only in apps/userscript/package.json and is
    // injected by scripts/build-userscript.mjs; no literal version may leak
    // into the template.
    expect(USERSCRIPT_METADATA).not.toMatch(/@version\s+\d+\.\d+\.\d+/)
  })

  it('does not declare ineffective @connect entries without GM_xmlhttpRequest', () => {
    expect(USERSCRIPT_METADATA).not.toContain('@connect')
  })
})
