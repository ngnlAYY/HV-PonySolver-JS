import { readdir } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

const DEFAULT_SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.tsx'])
// Shared ignore list so every scanner skips build output, dependencies, and VCS metadata.
const IGNORED_DIRECTORY_NAMES = new Set(['.git', 'coverage', 'dist', 'node_modules'])

export async function collectSourceFiles(dir, { extensions = DEFAULT_SOURCE_EXTENSIONS } = {}) {
  return createSourceFileCollector({ extensions })(dir)
}

/** 每次检查拥有独立快照，重叠目录只遍历一次，不跨检查缓存磁盘状态。 */
export function createSourceFileCollector({ extensions = DEFAULT_SOURCE_EXTENSIONS } = {}) {
  const pending = new Map()
  const collect = (dir) => {
    const absolute = resolve(dir)
    if (!pending.has(absolute)) pending.set(absolute, walk(absolute))
    return pending.get(absolute)
  }
  const walk = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
      const path = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          continue
        }
        files.push(...(await collect(path)))
        continue
      }
      if (entry.isFile() && extensions.has(extname(entry.name))) {
        files.push(path)
      }
    }
    return files
  }
  return collect
}
