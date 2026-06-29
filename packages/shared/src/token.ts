export const MODEL_ACCESS_TOKEN_PATTERN = /^[0-9a-fA-F]{64}$/

export function isModelAccessToken(value: string | null): value is string {
  return value !== null && MODEL_ACCESS_TOKEN_PATTERN.test(value)
}

export function normalizeModelAccessToken(value: string | null | undefined): string | null {
  const token = value?.trim()
  if (!token || !isModelAccessToken(token)) {
    return null
  }
  return token.toLowerCase()
}

export function getModelAccessTokenLookupKeys(value: string | null | undefined): readonly string[] {
  const originalToken = value?.trim() ?? ''
  const token = normalizeModelAccessToken(originalToken)
  if (token === null) {
    return []
  }

  const lookupKeys = [token]
  if (originalToken !== token) {
    lookupKeys.push(originalToken)
  }

  const uppercaseToken = token.toUpperCase()
  if (!lookupKeys.includes(uppercaseToken)) {
    lookupKeys.push(uppercaseToken)
  }

  return lookupKeys
}
