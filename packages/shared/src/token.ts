export const MODEL_ACCESS_TOKEN_PATTERN = /^[0-9a-fA-F]{64}$/

export function isModelAccessToken(value: string | null): value is string {
  return value !== null && MODEL_ACCESS_TOKEN_PATTERN.test(value)
}
