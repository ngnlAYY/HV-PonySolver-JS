import { createHash } from 'node:crypto'
import { open, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Zip, ZipDeflate } from 'fflate'
import { deterministicZipTimestamp, version } from './config.mjs'

function artifactBaseName(target, modelDelivery, fixture = false) {
  const modeSuffix = modelDelivery === 'packaged' ? '-packaged' : ''
  const fixtureSuffix = fixture ? '-fixture' : ''
  return `hv-pony-solver-${target}${modeSuffix}${fixtureSuffix}-${version}`
}

async function writeChunk(handle, bytes) {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset)
    if (bytesWritten === 0) throw new Error('Extension archive write made no progress')
    offset += bytesWritten
  }
}

export async function createArchive(targetDirectory, outputRoot, target, modelDelivery, fixture, inventory) {
  const archiveName = `${artifactBaseName(target, modelDelivery, fixture)}.zip`
  const archivePath = path.join(outputRoot, archiveName)
  const handle = await open(archivePath, 'w')
  const digest = createHash('sha256')
  let byteLength = 0
  let pendingWrite = Promise.resolve()
  let compressionError
  const zip = new Zip((error, bytes) => {
    if (error) {
      compressionError = error
      return
    }
    digest.update(bytes)
    byteLength += bytes.byteLength
    pendingWrite = pendingWrite.then(() => writeChunk(handle, bytes))
  })
  try {
    const entries = [
      ...inventory,
      { relativePath: 'build-manifest.json', bytes: await readFile(path.join(targetDirectory, 'build-manifest.json')) },
    ]
    for (const entry of entries) {
      const compressor = new ZipDeflate(entry.relativePath, { level: 9 })
      compressor.mtime = deterministicZipTimestamp
      zip.add(compressor)
      // 等待每个分块落盘后才继续压缩，避免持有整份压缩包或无界写入队列。
      const chunkSize = 64 * 1024
      if (entry.bytes.byteLength === 0) compressor.push(entry.bytes, true)
      for (let offset = 0; offset < entry.bytes.byteLength; offset += chunkSize) {
        const end = Math.min(offset + chunkSize, entry.bytes.byteLength)
        compressor.push(entry.bytes.subarray(offset, end), end === entry.bytes.byteLength)
        if (compressionError) throw compressionError
        await pendingWrite
      }
      if (compressionError) throw compressionError
      await pendingWrite
    }
    zip.end()
    if (compressionError) throw compressionError
    await pendingWrite
  } catch (error) {
    zip.terminate()
    await pendingWrite.catch(() => undefined)
    await handle.close()
    await rm(archivePath, { force: true })
    throw error
  }
  await handle.close()
  const archiveHash = digest.digest('hex')
  await writeFile(`${archivePath}.sha256`, `${archiveHash}  ${archiveName}\n`)
  return { archiveName, byteLength, sha256: archiveHash }
}

export { artifactBaseName }
