import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = path.join(extensionRoot, 'test', 'fixtures', 'packaged-model')
const filename = 'deterministic-captcha.ort'
const bytes = await readFile(path.join(fixtureRoot, filename))
const identity = {
  filename,
  byteLength: bytes.byteLength,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  input: { name: 'images', type: 'float32', dimensions: [1, 3, 640, 640] },
  output: { name: 'output0', type: 'float32', dimensions: [1, 6] },
  expected: { classId: 0, confidence: 0.95 },
  generator: {
    onnx: '1.20.1',
    onnxruntime: '1.27.0',
    requirements: 'scripts/ort-runtime/requirements.txt',
  },
}
await writeFile(path.join(fixtureRoot, 'identity.json'), `${JSON.stringify(identity, null, 2)}\n`)
