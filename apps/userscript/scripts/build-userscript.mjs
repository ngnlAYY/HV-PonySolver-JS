import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(scriptDir, '..')
const entryPoint = resolve(appDir, 'src/main.ts')
const outputPath = resolve(appDir, 'dist/hv-pony-solver.user.js')
const metadataPath = resolve(appDir, 'src/userscript/metadata.ts')

const result = await build({
  entryPoints: [entryPoint],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  legalComments: 'none',
  logLevel: 'info',
})

const metadataSource = await readFile(metadataPath, 'utf8')
const metadataMatch = metadataSource.match(/export\s+const\s+USERSCRIPT_METADATA\s*=\s*`([\s\S]*?)`/)
if (!metadataMatch) {
  throw new Error('Unable to read USERSCRIPT_METADATA template literal')
}

const metadata = metadataMatch[1]
const metadataLines = metadata.split('\n')
if (metadataLines[0] !== '// ==UserScript==') {
  throw new Error('Userscript metadata must start with // ==UserScript==')
}
if (metadataLines[metadataLines.length - 1] !== '// ==/UserScript==') {
  throw new Error('Userscript metadata must end with // ==/UserScript==')
}

const outputFile = result.outputFiles[0]
if (!outputFile) {
  throw new Error('esbuild did not return a bundle')
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${metadata}\n\n${outputFile.text}`)
