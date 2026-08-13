import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const requirementsPath = path.join(repositoryRoot, 'scripts', 'ort-runtime', 'requirements.txt')
const inputPath = path.join(repositoryRoot, 'scripts', 'ort-runtime', 'requirements.in')
const buildScriptPath = path.join(repositoryRoot, 'scripts', 'build-minimal-ort-runtime.sh')

function requirementBlocks(source) {
  const blocks = []
  let current = []
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    if (!rawLine.startsWith(' ') && current.length > 0) {
      blocks.push(current)
      current = []
    }
    current.push(line)
  }
  if (current.length > 0) {
    blocks.push(current)
  }
  return blocks
}

test('every ONNX conversion requirement has an exact version and hashes', async () => {
  const [requirements, input] = await Promise.all([
    readFile(requirementsPath, 'utf8'),
    readFile(inputPath, 'utf8'),
  ])
  const blocks = requirementBlocks(requirements)
  assert.ok(blocks.length >= 3)
  for (const block of blocks) {
    assert.match(block[0], /^[a-z0-9][a-z0-9._-]*==[^\\\s]+(?:\s+\\)?$/iu)
    assert.ok(block.some((line) => /^--hash=sha256:[a-f0-9]{64}(?:\s+\\)?$/u.test(line)))
  }
  for (const line of input.split(/\r?\n/u).filter(Boolean)) {
    assert.match(line, /^[a-z0-9][a-z0-9._-]*==[^\s]+$/iu)
  }
})

test('minimal runtime build installs only the tracked hash lock', async () => {
  const source = await readFile(buildScriptPath, 'utf8')
  assert.match(source, /--require-hashes -r "\$PYTHON_REQUIREMENTS"/u)
  assert.match(source, /PIP_VERSION=\d+\.\d+\.\d+/u)
  assert.doesNotMatch(source, /flatbuffers>=|onnxruntime==1\.27\.0'|onnx==1\.20\.1'/u)
})
