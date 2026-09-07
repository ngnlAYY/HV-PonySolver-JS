export const PROTOCOL_VERSION = 'hv-pony-solver/2' as const
export const CONTENT_PORT_NAME = 'hv-pony-solver:content' as const
export const OPTIONS_PORT_NAME = 'hv-pony-solver:options' as const
export const OFFSCREEN_MESSAGE_TYPE = 'hv-pony-solver:offscreen-request' as const

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys)
  return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key))
}

export function hasAllowedKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set([...required, ...optional])
  return (
    required.every((key) => key in value) &&
    Object.keys(value).length <= allowed.size &&
    Object.keys(value).every((key) => allowed.has(key))
  )
}

export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value)
}

export function isEpoch(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value)
}

export function isGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}
