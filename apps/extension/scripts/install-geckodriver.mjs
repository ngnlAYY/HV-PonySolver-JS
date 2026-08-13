import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { browserSupport } from './browser-support.mjs'

const execFileAsync = promisify(execFile)
const outputDirectory = path.resolve(process.argv[2] || path.join(os.tmpdir(), `geckodriver-${browserSupport.geckodriver.version}`))
const archivePath = path.join(outputDirectory, 'geckodriver.tar.gz')
const executablePath = path.join(outputDirectory, 'geckodriver')

await rm(outputDirectory, { recursive: true, force: true })
await mkdir(outputDirectory, { recursive: true })
const response = await globalThis.fetch(browserSupport.geckodriver.linuxArchiveUrl)
if (!response.ok) {
  throw new Error(`geckodriver download failed with HTTP ${response.status}`)
}
const archive = new Uint8Array(await response.arrayBuffer())
const digest = createHash('sha256').update(archive).digest('hex')
if (digest !== browserSupport.geckodriver.linuxArchiveSha256) {
  throw new Error(
    `geckodriver archive SHA-256 mismatch: expected ${browserSupport.geckodriver.linuxArchiveSha256}, received ${digest}`,
  )
}
await writeFile(archivePath, archive, { mode: 0o600 })
await execFileAsync('tar', ['-xzf', archivePath, '-C', outputDirectory])
await chmod(executablePath, 0o755)
await rm(archivePath, { force: true })

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `path=${executablePath}\nversion=${browserSupport.geckodriver.version}\n`)
}
process.stdout.write(`${executablePath}\n`)
