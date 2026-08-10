import {
  getModelAccessTokenLookupKeys,
  normalizeModelAccessToken,
  type ModelAccessDecision,
} from '@hv-pony-solver/shared'
import type { InvalidKeyMode, ModelKeyStore } from './worker-types'

const BEARER_AUTHORIZATION_PATTERN = /^Bearer\s+([^\s]+)$/i

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

export function getCanonicalRequestAccessToken(request: Request): string | null {
  return normalizeModelAccessToken(getRequestAccessToken(request))
}

export async function selectModelAccess(
  request: Request,
  keyStore: ModelKeyStore,
  invalidKeyMode: InvalidKeyMode,
): Promise<ModelAccessDecision> {
  const lookupKeys = getModelAccessTokenLookupKeys(getRequestAccessToken(request))

  if (lookupKeys.length === 0) {
    return invalidAccessDecision(invalidKeyMode)
  }

  for (const lookupKey of lookupKeys) {
    const authorizationMarker = await keyStore.get(lookupKey)
    if (authorizationMarker !== null) {
      return 'real'
    }
  }

  return invalidAccessDecision(invalidKeyMode)
}
