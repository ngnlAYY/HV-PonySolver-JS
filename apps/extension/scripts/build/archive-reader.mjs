import path from 'node:path'
import { crc32, inflateRawSync } from 'node:zlib'
import { strFromU8 } from 'fflate'

export const EXTENSION_ARCHIVE_LIMITS = Object.freeze({
  archiveByteLength: 32 * 1024 * 1024,
  entryByteLength: 16 * 1024 * 1024,
  entryCount: 128,
  treeByteLength: 32 * 1024 * 1024,
})

export function assertSafeArchiveEntryName(name, label) {
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.includes(':') ||
    path.posix.isAbsolute(name) ||
    path.posix.normalize(name) !== name ||
    name.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`${label} has an unsafe path: ${String(name)}`)
  }
}

// Check central and local metadata before inflating. fflate's unzip filter omits
// Unix file types, and its preallocated output can hide a false decoded length.
export function unzipArtifactArchive(artifact, archiveBytes, label) {
  if (archiveBytes.byteLength > EXTENSION_ARCHIVE_LIMITS.archiveByteLength) {
    throw new Error(`${label} exceeds the compressed size limit`)
  }
  const expectedNames = new Set([...Object.keys(artifact.files), 'build-manifest.json'])
  if (expectedNames.size > EXTENSION_ARCHIVE_LIMITS.entryCount) {
    throw new Error(`${label} exceeds the entry-count limit`)
  }
  const invalid = () => new Error(`${label} has invalid ZIP metadata`)
  const view = new DataView(archiveBytes.buffer, archiveBytes.byteOffset, archiveBytes.byteLength)
  const uint16 = (offset) => view.getUint16(offset, true)
  const uint32 = (offset) => view.getUint32(offset, true)
  let end = archiveBytes.byteLength - 22
  const earliestEnd = Math.max(0, archiveBytes.byteLength - 22 - 65_535)
  for (; end >= earliestEnd; end -= 1) {
    if (uint32(end) === 0x06054b50 && end + 22 + uint16(end + 20) === archiveBytes.byteLength) break
  }
  if (end < earliestEnd) throw invalid()
  const count = uint16(end + 10)
  if (count > EXTENSION_ARCHIVE_LIMITS.entryCount) {
    throw new Error(`${label} exceeds the entry-count limit`)
  }
  const centralStart = uint32(end + 16)
  const centralEnd = centralStart + uint32(end + 12)
  // Build artifacts fit ordinary single-disk ZIP; reject ZIP64 and split archives.
  if (uint16(end + 4) !== 0 || uint16(end + 6) !== 0 || uint16(end + 8) !== count || centralEnd !== end) throw invalid()

  const seenNames = new Set()
  const entries = []
  let treeByteLength = 0
  let cursor = centralStart
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > centralEnd || uint32(cursor) !== 0x02014b50) throw invalid()
    const flags = uint16(cursor + 8)
    const compression = uint16(cursor + 10)
    const checksum = uint32(cursor + 16)
    const size = uint32(cursor + 20)
    const originalSize = uint32(cursor + 24)
    const nameLength = uint16(cursor + 28)
    const next = cursor + 46 + nameLength + uint16(cursor + 30) + uint16(cursor + 32)
    if (next > centralEnd || uint16(cursor + 34) !== 0) throw invalid()
    const nameBytes = archiveBytes.subarray(cursor + 46, cursor + 46 + nameLength)
    const name = strFromU8(nameBytes, !(flags & 0x0800))
    assertSafeArchiveEntryName(name, `${label} entry`)
    if (seenNames.has(name)) throw new Error(`${label} contains a duplicate entry: ${name}`)
    seenNames.add(name)
    if (!expectedNames.has(name)) throw new Error(`${label} contains an unexpected entry: ${name}`)
    const attributes = uint32(cursor + 38)
    const unixType = (attributes >>> 16) & 0xf000
    if ((unixType !== 0 && unixType !== 0x8000) || (attributes & 0x10) !== 0) {
      throw new Error(`${label} contains a non-file entry: ${name}`)
    }
    if ((flags & 0x0041) !== 0 || (compression !== 0 && compression !== 8)) throw invalid()
    if (originalSize > EXTENSION_ARCHIVE_LIMITS.entryByteLength) {
      throw new Error(`${label} entry ${name} exceeds the uncompressed entry size limit`)
    }
    const declaredIdentity = artifact.files[name]
    if (declaredIdentity && originalSize !== declaredIdentity.byteLength) {
      throw new Error(`${label} entry ${name} size does not match artifact metadata`)
    }
    treeByteLength += originalSize
    if (treeByteLength > EXTENSION_ARCHIVE_LIMITS.treeByteLength) {
      throw new Error(`${label} exceeds the uncompressed tree size limit`)
    }
    const local = uint32(cursor + 42)
    if (local + 30 > centralStart || uint32(local) !== 0x04034b50) throw invalid()
    const localSize = uint32(local + 18)
    const localOriginalSize = uint32(local + 22)
    const localChecksum = uint32(local + 14)
    const dataStart = local + 30 + uint16(local + 26) + uint16(local + 28)
    const dataEnd = dataStart + size
    if (
      uint16(local + 6) !== flags ||
      uint16(local + 8) !== compression ||
      uint16(local + 26) !== nameLength ||
      dataEnd > centralStart ||
      nameBytes.some((byte, position) => byte !== archiveBytes[local + 30 + position]) ||
      (flags & 0x0008 ? localChecksum !== 0 && localChecksum !== checksum : localChecksum !== checksum) ||
      (flags & 0x0008
        ? (localSize !== 0 && localSize !== size) || (localOriginalSize !== 0 && localOriginalSize !== originalSize)
        : localSize !== size || localOriginalSize !== originalSize) ||
      entries.some((entry) => local < entry.dataEnd && dataEnd > entry.local)
    )
      throw invalid()
    entries.push({ name, compression, checksum, originalSize, local, dataStart, dataEnd })
    cursor = next
  }
  if (cursor !== centralEnd || seenNames.size !== expectedNames.size) throw invalid()
  return Object.fromEntries(
    entries.map(({ name, compression, checksum, originalSize, dataStart, dataEnd }) => {
      const compressed = archiveBytes.subarray(dataStart, dataEnd)
      const decoded =
        compression === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, originalSize) })
      if (decoded.byteLength !== originalSize)
        throw new Error(`${label} entry ${name} decoded length does not match ZIP metadata`)
      if (crc32(decoded) !== checksum) throw new Error(`${label} entry ${name} CRC does not match ZIP metadata`)
      return [name, decoded]
    }),
  )
}
