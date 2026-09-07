import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'

import { checkDocumentationLinks } from '../document-links.mjs'

async function createFixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'hv-document-links-'))
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(root, relativePath)
    await mkdir(join(filePath, '..'), { recursive: true })
    await writeFile(filePath, content)
  }
  return root
}

test('accepts local files, directories, headings, duplicate heading slugs, and external URLs', async () => {
  const root = await createFixture({
    'README.md': [
      '[guide](docs/guide.md#重复标题)',
      '[guide duplicate](docs/guide.md#重复标题-1)',
      '[directory](docs)',
      '[self](#项目概览)',
      '[encoded](docs/guide.md#api-v2测试)',
      '[source line](src/example.ts#L1)',
      '行内代码 ``[pseudo](docs/missing.md)`` 不是真实链接。',
      '[external](https://example.com/missing.md#anchor)',
      '',
      '# 项目概览',
      '',
      '```md',
      '[pseudo](docs/missing.md#missing)',
      '```',
    ].join('\n'),
    'docs/guide.md': ['# 重复标题', '## 重复标题', '### API `v2`（测试）'].join('\n'),
    'src/example.ts': 'export const value = 1\n',
  })

  assert.deepEqual(await checkDocumentationLinks(root), [])
})

test('reports missing files, missing anchors, outside links, and generated targets', async () => {
  const root = await createFixture({
    'README.md': [
      '[missing](docs/missing.md)',
      '[missing anchor](docs/guide.md#不存在)',
      '[outside](../../outside.md)',
      '[generated](apps/model-worker/wrangler.toml)',
    ].join('\n'),
    'docs/guide.md': '# 已存在标题\n',
    'apps/model-worker/wrangler.toml': 'generated = true\n',
  })

  const errors = await checkDocumentationLinks(root)
  assert.equal(errors.length, 4)
  assert.ok(errors.some((error) => error.includes('docs/missing.md') && error.includes('does not exist')))
  assert.ok(errors.some((error) => error.includes('#不存在') && error.includes('anchor')))
  assert.ok(errors.some((error) => error.includes('../../outside.md') && error.includes('repository')))
  assert.ok(errors.some((error) => error.includes('wrangler.toml') && error.includes('generated')))
})

test('reports malformed links and ignores links in fenced code blocks', async () => {
  const root = await createFixture({
    'README.md': ['```', '[ignored](missing-in-fence.md)', '```', '[broken](docs/%E0%A4%A.md)'].join('\n'),
  })

  const errors = await checkDocumentationLinks(root)
  assert.equal(errors.length, 1)
  assert.ok(errors[0].includes('docs/%E0%A4%A.md'))
})

test('fails closed when the documentation root cannot be scanned', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hv-document-links-root-'))
  const errors = await checkDocumentationLinks(join(root, 'missing'))
  assert.equal(errors.length, 1)
  assert.match(errors[0], /unable to scan documentation directory/)
})

test('follows in-repository symlinks, rejects escaped symlinks, and ignores generated directories', async () => {
  const outsideRoot = await mkdtemp(join(tmpdir(), 'hv-document-links-outside-'))
  await writeFile(join(outsideRoot, 'outside.md'), '# Outside\n')
  const root = await createFixture({
    'README.md': '[inside](docs/inside-link.md#inside)\n[escaped](docs/escaped-link.md#outside)\n',
    'docs/inside.md': '# Inside\n',
    '.codegraph/README.md': '[missing](missing.md)\n',
  })
  await symlink(join(root, 'docs/inside.md'), join(root, 'docs/inside-link.md'))
  await symlink(join(outsideRoot, 'outside.md'), join(root, 'docs/escaped-link.md'))

  const errors = await checkDocumentationLinks(root)
  assert.equal(errors.length, 1)
  assert.ok(errors[0].includes('escaped-link.md'))
  assert.ok(errors[0].includes('escapes the repository'))
})

test('keeps heading slugs unique when explicit suffixed headings collide', async () => {
  const root = await createFixture({
    'README.md': '[first](docs/headings.md#foo)\n[second](docs/headings.md#foo-1)\n[third](docs/headings.md#foo-2)\n',
    'docs/headings.md': '# Foo\n# Foo-1\n# Foo\n',
  })

  assert.deepEqual(await checkDocumentationLinks(root), [])
})

test('accepts a repository root passed through a symlink', async () => {
  const root = await createFixture({
    'README.md': '[guide](docs/guide.md#guide)\n',
    'docs/guide.md': '# Guide\n',
  })
  const alias = join(await mkdtemp(join(tmpdir(), 'hv-document-links-alias-parent-')), 'repo-alias')
  await symlink(root, alias, 'dir')

  assert.deepEqual(await checkDocumentationLinks(alias), [])
})
