import { isModelAccessToken, type ModelAccessDecision } from '@hv-pony-solver/shared'
import type { NormalizedEnv } from './worker-types'

export async function selectModelAccess(request: Request, env: NormalizedEnv): Promise<ModelAccessDecision> {
  const key = new URL(request.url).searchParams.get('key')

  if (!isModelAccessToken(key)) {
    return env.invalidKeyMode === 'error' ? 'forbidden' : 'decoy'
  }

  const authorizationMarker = await env.modelKeys.get(key)
  if (authorizationMarker === null) {
    return env.invalidKeyMode === 'error' ? 'forbidden' : 'decoy'
  }

  return 'real'
}
