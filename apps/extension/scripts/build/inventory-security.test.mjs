import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { EXTENSION_PATHS } from '../../src/platform/extension-paths.ts'
import { runtimeWasmFilename } from './config.mjs'
import { auditTargetInventory } from './inventory.mjs'
import { createManifest } from './policy.mjs'

const modelBytes = Buffer.from('local audit fixture, not a production model')
const model = {
  filename: 'yolo26n-640.ort',
  byteLength: modelBytes.byteLength,
  sha256: createHash('sha256').update(modelBytes).digest('hex'),
}

function inventory(target, modelDelivery, mutateManifest = () => {}, html = '<script src="options.js"></script>') {
  const manifest = createManifest(target, { modelDelivery })
  mutateManifest(manifest)
  const sources = {
    'manifest.json': JSON.stringify(manifest),
    [EXTENSION_PATHS.backgroundScript]: '',
    [EXTENSION_PATHS.contentScript]: '',
    [EXTENSION_PATHS.optionsPage]: html,
    [EXTENSION_PATHS.optionsScript]: '',
    [EXTENSION_PATHS.optionsStyles]: '',
    [EXTENSION_PATHS.inferenceWorker]: '',
    [`runtime/${runtimeWasmFilename}`]: '',
  }
  if (target === 'chromium') {
    sources[EXTENSION_PATHS.offscreenPage] = '<script src="offscreen.js"></script>'
    sources[EXTENSION_PATHS.offscreenScript] = ''
  }
  if (modelDelivery === 'packaged') sources[`model/${model.filename}`] = modelBytes
  return Object.entries(sources).map(([relativePath, source]) => ({ relativePath, bytes: Buffer.from(source) }))
}

const manifestMutations = [
  [
    'Manifest V2',
    (manifest) => {
      manifest.manifest_version = 2
    },
    /Manifest V3/u,
  ],
  [
    'mismatched version',
    (manifest) => {
      manifest.version = '99.0.0'
    },
    /version/u,
  ],
  [
    'missing action',
    (manifest) => {
      delete manifest.action
    },
    /action declaration/u,
  ],
  [
    'popup intercepts action',
    (manifest) => {
      manifest.action.default_popup = 'options/options.html'
    },
    /action declaration/u,
  ],
  [
    'optional API permissions',
    (manifest) => {
      manifest.optional_permissions = ['tabs']
    },
    /optional_permissions/u,
  ],
  [
    'optional host permissions',
    (manifest) => {
      manifest.optional_host_permissions = ['<all_urls>']
    },
    /optional_host_permissions/u,
  ],
  [
    'external messaging',
    (manifest) => {
      manifest.externally_connectable = { matches: ['https://*/*'] }
    },
    /externally_connectable/u,
  ],
  [
    'sandbox pages',
    (manifest) => {
      manifest.sandbox = { pages: ['options/options.html'] }
    },
    /sandbox/u,
  ],
  [
    'extra background entry',
    (manifest) => {
      manifest.background.page = 'options/options.html'
    },
    /background declaration/u,
  ],
  [
    'persistent background',
    (manifest) => {
      manifest.background.persistent = true
    },
    /background declaration/u,
  ],
  [
    'non-tab settings',
    (manifest) => {
      manifest.options_ui.open_in_tab = false
    },
    /options page declaration/u,
  ],
  [
    'expanded matches',
    (manifest) => {
      manifest.content_scripts[0].matches = ['<all_urls>']
    },
    /content script declaration/u,
  ],
  [
    'missing exclusions',
    (manifest) => {
      delete manifest.content_scripts[0].exclude_matches
    },
    /content script declaration/u,
  ],
  [
    'all frames',
    (manifest) => {
      manifest.content_scripts[0].all_frames = true
    },
    /content script declaration/u,
  ],
  [
    'MAIN world',
    (manifest) => {
      manifest.content_scripts[0].world = 'MAIN'
    },
    /content script declaration/u,
  ],
  [
    'about:blank injection',
    (manifest) => {
      manifest.content_scripts[0].match_about_blank = true
    },
    /content script declaration/u,
  ],
  [
    'origin fallback injection',
    (manifest) => {
      manifest.content_scripts[0].match_origin_as_fallback = true
    },
    /content script declaration/u,
  ],
  [
    'early injection',
    (manifest) => {
      manifest.content_scripts[0].run_at = 'document_start'
    },
    /content script declaration/u,
  ],
  [
    'additional scripts',
    (manifest) => {
      manifest.content_scripts[0].js.push('options/options.js')
    },
    /content script declaration/u,
  ],
  [
    'additional CSP',
    (manifest) => {
      manifest.content_security_policy.sandbox = "script-src 'unsafe-inline'"
    },
    /CSP/u,
  ],
]

for (const target of ['chromium', 'firefox']) {
  for (const modelDelivery of ['remote', 'packaged']) {
    const options = { modelDelivery, model }
    test(`accepts unchanged ${target}/${modelDelivery} security policy`, async () => {
      await auditTargetInventory(target, options, inventory(target, modelDelivery))
    })
    for (const [label, mutate, expected] of manifestMutations) {
      test(`rejects ${label} in ${target}/${modelDelivery}`, async () => {
        await assert.rejects(auditTargetInventory(target, options, inventory(target, modelDelivery, mutate)), expected)
      })
    }
  }
}

const unsafeHtml = [
  ['event handler', '<button onclick="alert(1)">Click</button>', /inline event handler/u],
  ['mixed-case handler', '<body onLoad="alert(1)"></body>', /inline event handler/u],
  ['SVG handler', '<svg onload="alert(1)"></svg>', /inline event handler/u],
  ['template handler', '<template><button onclick="alert(1)">Click</button></template>', /inline event handler/u],
  ['JavaScript URL', '<a href="javascript:alert(1)">Click</a>', /executable URL/u],
  ['encoded JavaScript URL', '<a href="java&#x0a;script:alert(1)">Click</a>', /executable URL/u],
  ['form JavaScript URL', '<button formaction=" JAVASCRIPT:alert(1)">Click</button>', /executable URL/u],
  ['SVG JavaScript URL', '<svg><a xlink:href="javascript:alert(1)">Click</a></svg>', /executable URL/u],
  ['inline frame', '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>', /srcdoc/u],
  ['base override', '<base href="https://untrusted.invalid/"><script src="options.js"></script>', /base/u],
  ['template script', '<template><template><script>alert(1)</script></template></template>', /inline script/u],
  [
    'template remote script',
    '<template><script src="https://untrusted.invalid/script.js"></script></template>',
    /remote executable/u,
  ],
]

for (const [label, html, expected] of unsafeHtml) {
  test(`rejects ${label} in packaged HTML`, async () => {
    await assert.rejects(
      auditTargetInventory(
        'chromium',
        { modelDelivery: 'packaged', model },
        inventory('chromium', 'packaged', undefined, html),
      ),
      expected,
    )
  })
}

test('does not mistake inert text, data attributes or comments for executable HTML', async () => {
  await auditTargetInventory(
    'chromium',
    { modelDelivery: 'remote' },
    inventory(
      'chromium',
      'remote',
      undefined,
      `
      <!-- onclick="alert(1)" -->
      <p data-note="javascript:example">onclick is not allowed</p>
      <template><span>Plain template content</span></template>
      <link href="options.css" rel="stylesheet">
      <script src="options.js"></script>
    `,
    ),
  )
})
