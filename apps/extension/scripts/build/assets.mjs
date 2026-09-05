import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  packagedModelIdentity,
  dynamicRuntimeImport,
  disabledDynamicRuntimeImport,
  fixtureIdentityNamespace,
  packagedModelIdentityModule,
  fixtureDetectHookModule,
  fixtureDetectDelayModule,
  runtimeWasmSource,
  runtimeGlueSource,
  runtimeWasmSha256,
  runtimeGlueSha256,
} from './config.mjs'

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function assertPackagedModelIdentity(identity) {
  if (!identity || !/^[A-Za-z0-9._-]+\.ort$/u.test(identity.filename ?? '')) {
    throw new Error('Packaged model identity has an invalid filename')
  }
  if (!Number.isSafeInteger(identity.byteLength) || identity.byteLength <= 0) {
    throw new Error('Packaged model identity has an invalid byte length')
  }
  if (!/^[a-f0-9]{64}$/u.test(identity.sha256 ?? '')) {
    throw new Error('Packaged model identity has an invalid SHA-256')
  }
}

function verifyPackagedModelBytes(bytes, identity) {
  assertPackagedModelIdentity(identity)
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('Packaged model bytes must be a Uint8Array')
  }
  if (bytes.byteLength !== identity.byteLength) {
    throw new Error(
      `Packaged model byte length mismatch: expected ${identity.byteLength}, received ${bytes.byteLength}`,
    )
  }
  const actualSha256 = sha256(bytes)
  if (actualSha256 !== identity.sha256) {
    throw new Error(`Packaged model SHA-256 mismatch: expected ${identity.sha256}, received ${actualSha256}`)
  }
  return { bytes, identity: { ...identity } }
}

export async function verifyPackagedModelFile(sourcePath, identity = packagedModelIdentity) {
  let stats
  try {
    stats = await lstat(sourcePath)
  } catch (error) {
    throw new Error(`Unable to inspect packaged model source: ${sourcePath}`, { cause: error })
  }
  if (stats.isSymbolicLink()) {
    throw new Error(`Packaged model source must not be a symbolic link: ${sourcePath}`)
  }
  if (!stats.isFile()) {
    throw new Error(`Packaged model source must be a regular file: ${sourcePath}`)
  }
  const bytes = await readFile(sourcePath)
  return verifyPackagedModelBytes(bytes, identity)
}

function extensionRuntimeGluePlugin() {
  return {
    name: 'extension-runtime-glue',
    setup(buildApi) {
      buildApi.onLoad({ filter: /ort\.wasm\.bundle\.min\.mjs$/ }, async (args) => {
        const source = await readFile(args.path, 'utf8')
        const firstMatch = source.indexOf(dynamicRuntimeImport)
        if (firstMatch < 0 || source.indexOf(dynamicRuntimeImport, firstMatch + 1) >= 0) {
          throw new Error('Expected exactly one dynamic import in the tracked ONNX Runtime glue')
        }
        return {
          contents: source.replace(dynamicRuntimeImport, disabledDynamicRuntimeImport),
          loader: 'js',
        }
      })
    },
  }
}

function packagedModelIdentityPlugin(identity) {
  assertPackagedModelIdentity(identity)
  return {
    name: fixtureIdentityNamespace,
    setup(buildApi) {
      buildApi.onResolve({ filter: /^\.\/packaged-model-identity$/ }, (args) => {
        const resolved = path.resolve(args.resolveDir, `${args.path}.ts`)
        if (resolved !== packagedModelIdentityModule) {
          return undefined
        }
        return { path: 'identity', namespace: fixtureIdentityNamespace }
      })
      buildApi.onLoad({ filter: /.*/, namespace: fixtureIdentityNamespace }, () => ({
        contents: JSON.stringify({
          PACKAGED_MODEL_FILENAME: identity.filename,
          PACKAGED_MODEL_INTEGRITY: {
            byteLength: identity.byteLength,
            sha256: identity.sha256,
          },
        }),
        loader: 'json',
      }))
    },
  }
}

function fixtureDetectHookPlugin() {
  return {
    name: 'fixture-detect-hook',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^\.\/fixture-detect-hook$/ }, (args) => {
        const resolved = path.resolve(args.resolveDir, `${args.path}.ts`)
        if (resolved !== fixtureDetectHookModule) {
          return undefined
        }
        return { path: fixtureDetectDelayModule }
      })
    },
  }
}

async function assertRuntimeAssets() {
  const [wasmBytes, glueBytes] = await Promise.all([readFile(runtimeWasmSource), readFile(runtimeGlueSource)])
  if (sha256(wasmBytes) !== runtimeWasmSha256) {
    throw new Error('Tracked ONNX Runtime WASM failed its SHA-256 check')
  }
  if (sha256(glueBytes) !== runtimeGlueSha256) {
    throw new Error('Tracked ONNX Runtime JavaScript glue failed its SHA-256 check')
  }
}

export {
  sha256,
  assertPackagedModelIdentity,
  verifyPackagedModelBytes,
  extensionRuntimeGluePlugin,
  packagedModelIdentityPlugin,
  fixtureDetectHookPlugin,
  assertRuntimeAssets,
}
