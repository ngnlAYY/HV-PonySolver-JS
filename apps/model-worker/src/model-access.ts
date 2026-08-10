import { getModelAccessTokenLookupKeys, type ModelAccessDecision } from '@hv-pony-solver/shared'
import type { NormalizedEnv } from './worker-types'

const BEARER_AUTHORIZATION_PATTERN = /^Bearer\s+([^\s]+)$/i

function invalidAccessDecision(env: NormalizedEnv): ModelAccessDecision {
  return env.invalidKeyMode === 'error' ? 'forbidden' : 'decoy'
}

function getRequestAccessToken(request: Request): string | null {
  const authorization = request.headers.get('authorization')
  if (authorization === null) {
    return null
  }

  const match = BEARER_AUTHORIZATION_PATTERN.exec(authorization.trim())
  return match?.[1] ?? null
}

export async function selectModelAccess(request: Request, env: NormalizedEnv): Promise<ModelAccessDecision> {
  const lookupKeys = getModelAccessTokenLookupKeys(getRequestAccessToken(request))

  if (lookupKeys.length === 0) {
    return invalidAccessDecision(env)
  }

  for (const lookupKey of lookupKeys) {
    const authorizationMarker = await env.MODEL_KEYS.get(lookupKey)
    if (authorizationMarker !== null) {
      return 'real'
    }
  }

  return invalidAccessDecision(env)
}
