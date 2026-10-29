import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'
import { Zip, ZipDeflate, zipSync } from 'fflate'
import { EXTENSION_ARCHIVE_LIMITS, unzipArtifactArchive } from './archive-reader.mjs'

function fixture(sources = { 'runtime/file.js': Buffer.from('a valid payload') }, options) {
  const files = Object.fromEntries(
    Object.entries(sources).map(([name, bytes]) => [name, { byteLength: bytes.byteLength }]),
  )
  const archive = Buffer.from(zipSync({ ...sources, 'build-manifest.json': Buffer.from('{}') }, options))
  return { artifact: { files }, archive, read: () => unzipArtifactArchive({ files }, archive, 'fixture archive') }
}

function headers(archive, name) {
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  let central = archive.readUInt32LE(end + 16)
  for (let index = 0; index < archive.readUInt16LE(end + 10); index += 1) {
    const nameLength = archive.readUInt16LE(central + 28)
    if (archive.toString('utf8', central + 46, central + 46 + nameLength) === name) {
      return { central, local: archive.readUInt32LE(central + 42), end }
    }
    central += 46 + nameLength + archive.readUInt16LE(central + 30) + archive.readUInt16LE(central + 32)
  }
  throw new Error('Fixture entry is missing')
}

test('reads stored and compressed regular files, including UTF-8 paths and Unix regular-file metadata', () => {
  for (const level of [0, 6]) {
    const name = 'runtime/合法.js'
    const bytes = Buffer.from('verified payload')
    const value = fixture({ [name]: bytes }, { level })
    const { central } = headers(value.archive, name)
    value.archive.writeUInt16LE(0x0314, central + 4)
    value.archive.writeUInt32LE((0x81a4 << 16) >>> 0, central + 38)
    assert.deepEqual(Buffer.from(value.read()[name]), bytes)
  }
})

test('reads the streaming ZIP format emitted by the extension builder', () => {
  const chunks = []
  const zip = new Zip((error, bytes) => {
    if (error) throw error
    chunks.push(Buffer.from(bytes))
  })
  const sources = { 'runtime/file.js': Buffer.from('payload'), 'build-manifest.json': Buffer.from('{}') }
  for (const [name, bytes] of Object.entries(sources)) {
    const entry = new ZipDeflate(name)
    zip.add(entry)
    entry.push(bytes, true)
  }
  zip.end()
  const archive = Buffer.concat(chunks)
  const artifact = { files: { 'runtime/file.js': { byteLength: sources['runtime/file.js'].byteLength } } }
  const read = () => unzipArtifactArchive(artifact, archive, 'streaming archive')
  assert.deepEqual(read(), sources)
  const { local } = headers(archive, 'runtime/file.js')
  archive.writeUInt32LE(0xffff_ffff, local + 22)
  assert.throws(read, /invalid ZIP metadata/u)
})

test('rejects unsafe ZIP entry names before decoding', () => {
  for (const name of [
    '../escape.js',
    '/absolute.js',
    'C:drive.js',
    'a:b.js',
    'a\\b.js',
    'a\0b.js',
    'a//b.js',
    'a/./b.js',
    'a/../b.js',
    'directory/',
  ]) {
    const value = fixture({ [name]: Buffer.from('payload') })
    assert.throws(value.read, /unsafe path/u, name)
  }
})

test('rejects Unix symlinks and other special files even when payload bytes are valid', () => {
  for (const attributes of [(0xa1ff << 16) >>> 0, (0x41ed << 16) >>> 0, (0x11a4 << 16) >>> 0, 0x10]) {
    const value = fixture()
    const { central } = headers(value.archive, 'runtime/file.js')
    value.archive.writeUInt16LE(0x0314, central + 4)
    value.archive.writeUInt32LE(attributes, central + 38)
    assert.throws(value.read, /non-file entry/u)
  }
})

test('rejects duplicate names and mismatched local names', () => {
  const duplicate = fixture({ 'runtime/a.js': Buffer.from('a'), 'runtime/b.js': Buffer.from('b') })
  const { central, local } = headers(duplicate.archive, 'runtime/b.js')
  duplicate.archive.write('runtime/a.js', central + 46)
  duplicate.archive.write('runtime/a.js', local + 30)
  assert.throws(duplicate.read, /duplicate entry/u)
  const inconsistent = fixture()
  const entry = headers(inconsistent.archive, 'runtime/file.js')
  inconsistent.archive[entry.local + 30] = 0x78
  assert.throws(inconsistent.read, /invalid ZIP metadata/u)
})

test('rejects false decoded lengths for both deflated and stored entries', () => {
  for (const level of [0, 6]) {
    for (const declaredLength of [1, 64]) {
      const value = fixture(undefined, { level })
      const { central, local } = headers(value.archive, 'runtime/file.js')
      value.archive.writeUInt32LE(declaredLength, central + 24)
      value.archive.writeUInt32LE(declaredLength, local + 22)
      value.artifact.files['runtime/file.js'].byteLength = declaredLength
      assert.throws(value.read, /decoded length|larger than/u)
    }
  }
})

test('rejects corrupted CRC metadata even when decoded bytes and lengths still match', () => {
  for (const level of [0, 6]) {
    const value = fixture(undefined, { level })
    const { central, local } = headers(value.archive, 'runtime/file.js')
    const corruptedCrc = (value.archive.readUInt32LE(central + 16) ^ 1) >>> 0
    value.archive.writeUInt32LE(corruptedCrc, central + 16)
    value.archive.writeUInt32LE(corruptedCrc, local + 14)
    assert.throws(value.read, /CRC/u)
  }
})

test('bounds ZIP entry count, entry size, and total decoded bytes before inflation', () => {
  const count = fixture(
    Object.fromEntries(
      Array.from({ length: EXTENSION_ARCHIVE_LIMITS.entryCount }, (_, index) => [`file-${index}`, Buffer.from('x')]),
    ),
  )
  assert.throws(count.read, /entry-count limit/u)
  const oversized = fixture()
  const oversizedHeader = headers(oversized.archive, 'runtime/file.js')
  oversized.archive.writeUInt32LE(EXTENSION_ARCHIVE_LIMITS.entryByteLength + 1, oversizedHeader.central + 24)
  assert.throws(oversized.read, /uncompressed entry size limit/u)
  const total = fixture({ a: Buffer.from('a'), b: Buffer.from('b'), c: Buffer.from('c') })
  for (const name of ['a', 'b', 'c']) {
    const entry = headers(total.archive, name)
    const size = name === 'c' ? 1 : EXTENSION_ARCHIVE_LIMITS.entryByteLength
    total.archive.writeUInt32LE(size, entry.central + 24)
    total.archive.writeUInt32LE(size, entry.local + 22)
    total.artifact.files[name].byteLength = size
  }
  assert.throws(total.read, /uncompressed tree size limit/u)
})

test('rejects malformed, encrypted, split, and inconsistent ZIP metadata', () => {
  assert.throws(() => unzipArtifactArchive({ files: {} }, Buffer.alloc(0), 'empty'), /invalid ZIP metadata/u)
  for (const mutate of [
    (archive, { end }) => archive.writeUInt16LE(1, end + 4),
    (archive, { end }) => archive.writeUInt32LE(0, end + 12),
    (archive, { central }) => archive.writeUInt32LE(0, central),
    (archive, { central }) => archive.writeUInt16LE(0xffff, central + 28),
    (archive, { central }) => archive.writeUInt16LE(1, central + 8),
    (archive, { central }) => archive.writeUInt16LE(99, central + 10),
    (archive, { central }) => archive.writeUInt32LE(0xffff_ffff, central + 42),
    (archive, { local }) => archive.writeUInt32LE(0, local),
    (archive, { local }) => archive.writeUInt32LE((archive.readUInt32LE(local + 14) ^ 1) >>> 0, local + 14),
    (archive, { local }) => archive.writeUInt32LE(1, local + 18),
  ]) {
    const value = fixture()
    mutate(value.archive, headers(value.archive, 'runtime/file.js'))
    assert.throws(value.read, /invalid ZIP metadata/u)
  }
  const mismatch = fixture()
  mismatch.artifact.files['runtime/file.js'].byteLength += 1
  assert.throws(mismatch.read, /size does not match artifact metadata/u)
})
