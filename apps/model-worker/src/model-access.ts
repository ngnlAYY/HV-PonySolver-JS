import {
  getModelAccessTokenLookupKeys,
  normalizeModelAccessToken,
  type ModelAccessDecision,
} from '@hv-pony-solver/shared'
import type { InvalidKeyMode, ModelKeyStore } from './worker-types'
import { withModelWorkerDependencyTimeout } from './request-timeout'

const BEARER_AUTHORIZATION_PATTERN = /^Bearer\s+([^\s]+)$/i

export type SelectedModelAccess = Readonly<{
  decision: ModelAccessDecision
  canonicalToken: string | null
}>

function invalidAccessDecision(invalidKeyMode: InvalidKeyMode): ModelAccessDecision {
  return invalidKeyMode === 'error' ? 'forbidden' : 'decoy'
}

function getRequestAccessToken(request: Request): string | null {
  const authorization = request.headers.get('authorization')
  if (authorization === null) {
    return null
  }

  const match = BEARER_AUTHORIZATION_PATTERN.exec(authorization.trim())
  return match?.[1] ?? null
}

async function hasAuthorizedLookupKey(keyStore: ModelKeyStore, lookupKeys: readonly string[]): Promise<boolean> {
  for (const lookupKey of lookupKeys) {
    const marker = await keyStore.get(lookupKey)
    if (marker !== null && marker.trim().length > 0) {
      return true
    }
  }
  return false
}

export async function selectModelAccess(
  request: Request,
  keyStore: ModelKeyStore,
  invalidKeyMode: InvalidKeyMode,
): Promise<SelectedModelAccess> {
  // The Authorization header is parsed exactly once per request: the same raw token
  // feeds both the KV lookup keys and the canonical token returned to callers.
  const requestToken = getRequestAccessToken(request)
  const canonicalToken = normalizeModelAccessToken(requestToken)
  const lookupKeys = getModelAccessTokenLookupKeys(requestToken)

  if (lookupKeys.length === 0) {
    return { decision: invalidAccessDecision(invalidKeyMode), canonicalToken }
  }

  if (await withModelWorkerDependencyTimeout(hasAuthorizedLookupKey(keyStore, lookupKeys), 'KV')) {
    return { decision: 'real', canonicalToken }
  }

  return { decision: invalidAccessDecision(invalidKeyMode), canonicalToken }
}
