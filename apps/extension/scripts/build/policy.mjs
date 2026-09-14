import { lstat, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { browserSupport } from '../browser/browser-support.mjs'
import { EXTENSION_PATHS } from '../../src/platform/extension-paths.ts'
import {
  extensionRoot,
  repositoryRoot,
  version,
  modelDeliveryModes,
  remoteModelOrigin,
  remoteModelHost,
  contentMatches,
  contentExcludes,
} from './config.mjs'

function isPathWithin(candidate, root) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function canonicalizePotentialPath(candidate) {
  const resolved = path.resolve(candidate)
  const missingSegments = []
  let current = resolved
  while (true) {
    try {
      const canonicalParent = await realpath(current)
      return path.join(canonicalParent, ...missingSegments.reverse())
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new Error(`Unable to canonicalize extension output path: ${resolved}`, { cause: error })
      }
      const parent = path.dirname(current)
      if (parent === current) {
        throw new Error(`Unable to canonicalize extension output path: ${resolved}`, { cause: error })
      }
      missingSegments.push(path.basename(current))
      current = parent
    }
  }
}

export async function assertSafeBuildOutputRoot(requestedOutputRoot) {
  if (typeof requestedOutputRoot !== 'string' || requestedOutputRoot.trim() === '') {
    throw new TypeError('Extension output root must be a non-empty path')
  }
  const resolvedOutputRoot = path.resolve(requestedOutputRoot)
  try {
    const stats = await lstat(resolvedOutputRoot)
    if (stats.isSymbolicLink()) {
      throw new Error(`Extension output root must not be a symbolic link: ${resolvedOutputRoot}`)
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }

  const rootCandidates = [extensionRoot, os.tmpdir(), process.cwd(), os.homedir(), repositoryRoot]
  if (process.env.RUNNER_TEMP) {
    rootCandidates.push(process.env.RUNNER_TEMP)
  }
  const [
    canonicalOutputRoot,
    canonicalExtensionRoot,
    canonicalTemporaryRoot,
    canonicalCwd,
    canonicalHome,
    canonicalRepository,
    canonicalRunnerRoot,
  ] = await Promise.all([
    canonicalizePotentialPath(resolvedOutputRoot),
    ...rootCandidates.map((candidate) => canonicalizePotentialPath(candidate)),
  ])
  const filesystemRoot = path.parse(canonicalOutputRoot).root
  if (
    canonicalOutputRoot === filesystemRoot ||
    [canonicalCwd, canonicalHome, canonicalRepository].some((protectedPath) =>
      isPathWithin(protectedPath, canonicalOutputRoot),
    )
  ) {
    throw new Error(`Refusing to recursively remove protected path: ${canonicalOutputRoot}`)
  }

  const canonicalDefaultRoot = path.join(canonicalExtensionRoot, 'dist')
  const isDefaultBuildOutput = isPathWithin(canonicalOutputRoot, canonicalDefaultRoot)
  if (isPathWithin(canonicalOutputRoot, canonicalRepository) && !isDefaultBuildOutput) {
    throw new Error(`Refusing to recursively remove source tree path: ${canonicalOutputRoot}`)
  }

  const isUsableTemporaryRoot = (candidate) =>
    candidate !== path.parse(candidate).root &&
    ![canonicalCwd, canonicalHome, canonicalRepository].includes(candidate) &&
    !isPathWithin(candidate, canonicalRepository)
  const isTemporaryOutput =
    isUsableTemporaryRoot(canonicalTemporaryRoot) &&
    canonicalOutputRoot !== canonicalTemporaryRoot &&
    isPathWithin(canonicalOutputRoot, canonicalTemporaryRoot)
  const isRunnerTemporaryOutput =
    canonicalRunnerRoot !== undefined &&
    isUsableTemporaryRoot(canonicalRunnerRoot) &&
    canonicalOutputRoot !== canonicalRunnerRoot &&
    isPathWithin(canonicalOutputRoot, canonicalRunnerRoot)
  if (!isDefaultBuildOutput && !isTemporaryOutput && !isRunnerTemporaryOutput) {
    throw new Error(`Extension output root is outside allowed build roots: ${canonicalOutputRoot}`)
  }
  return canonicalOutputRoot
}

function extensionContentSecurityPolicy(modelDelivery) {
  const connectSources = modelDelivery === 'remote' ? `'self' ${remoteModelOrigin}` : "'self'"
  return `script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; worker-src 'self'; connect-src ${connectSources}`
}

function normalizeModelDelivery(value = 'remote') {
  if (!modelDeliveryModes.has(value)) {
    throw new Error(`Unsupported extension model delivery mode: ${value}`)
  }
  return value
}

export function parseBuildArguments(args) {
  let modelDelivery = 'remote'
  let modelModeSeen = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    let value
    if (argument === '--model-mode') {
      value = args[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error('--model-mode requires remote or packaged')
      }
      index += 1
    } else if (argument.startsWith('--model-mode=')) {
      value = argument.slice('--model-mode='.length)
      if (!value) {
        throw new Error('--model-mode requires remote or packaged')
      }
    } else {
      throw new Error(`Unknown extension build argument: ${argument}`)
    }
    if (modelModeSeen) {
      throw new Error('--model-mode may be provided only once')
    }
    modelDelivery = normalizeModelDelivery(value)
    modelModeSeen = true
  }
  return { modelDelivery }
}

function commonManifest(modelDelivery = 'remote') {
  modelDelivery = normalizeModelDelivery(modelDelivery)
  return {
    manifest_version: 3,
    name: 'HV Pony Solver',
    version,
    description: 'Locally recognizes HentaiVerse pony captchas with a packaged ONNX runtime.',
    permissions: ['storage'],
    host_permissions: [...contentMatches, ...(modelDelivery === 'remote' ? [remoteModelHost] : [])],
    content_scripts: [
      {
        matches: contentMatches,
        exclude_matches: contentExcludes,
        js: [EXTENSION_PATHS.contentScript],
        run_at: 'document_idle',
      },
    ],
    action: {
      default_title: 'HV Pony Solver 设置',
    },
    options_ui: {
      page: EXTENSION_PATHS.optionsPage,
      open_in_tab: true,
    },
    content_security_policy: {
      extension_pages: extensionContentSecurityPolicy(modelDelivery),
    },
  }
}

export function createManifest(target, options = {}) {
  const modelDelivery = normalizeModelDelivery(options.modelDelivery)
  const common = commonManifest(modelDelivery)
  if (target === 'chromium') {
    return {
      ...common,
      minimum_chrome_version: browserSupport.chromium.manifestMinimumVersion,
      permissions: [...common.permissions, 'offscreen'],
      background: {
        service_worker: EXTENSION_PATHS.backgroundScript,
      },
    }
  }
  if (target === 'firefox') {
    return {
      ...common,
      background: {
        scripts: [EXTENSION_PATHS.backgroundScript],
      },
      browser_specific_settings: {
        gecko: {
          id: 'hv-pony-solver@ngnl.host',
          strict_min_version: browserSupport.firefox.manifestMinimumVersion,
          data_collection_permissions: {
            required: [modelDelivery === 'remote' ? 'authenticationInfo' : 'none'],
          },
        },
        gecko_android: {
          strict_min_version: browserSupport.firefox.androidManifestMinimumVersion,
        },
      },
    }
  }
  throw new Error(`Unsupported extension target: ${target}`)
}

export { extensionContentSecurityPolicy, normalizeModelDelivery }
