import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isDirectRun } from './lib/direct-run.mjs'
import { readModelManifest } from './model-manifest.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')

export function createModelReleaseNotes(manifest) {
  return [
    '# 模型发布说明',
    '',
    `- Version: ${manifest.version}`,
    `- Byte length: ${manifest.byteLength} bytes`,
    `- SHA-256: ${manifest.sha256}`,
    '',
    '## 发布前验证',
    '',
    '- 运行 `MODEL_FILE=/path/to/model.onnx corepack pnpm --filter @hv-pony-solver/userscript verify-model-integrity`，确认待上传模型与 shared manifest 一致。',
    '- 上传已验证模型到配置的 R2 real object key。',
    '- 保留上一版 R2 object，直到新 userscript release 已完成验证。',
    '',
  ].join('\n')
}

if (isDirectRun(import.meta.url)) {
  const manifest = await readModelManifest(repoRoot)
  process.stdout.write(createModelReleaseNotes(manifest))
}
