// eslint-disable-next-line no-control-regex -- These code points are the validation target.
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
// Paths flow verbatim into the Content-Disposition quoted-string emitted by model-response.ts,
// so quote-like characters are rejected for parity with scripts/wrangler-config-guard.mjs's TOML string rule.
const FORBIDDEN_PATH_CHARACTER_PATTERN = /["'`\\]/

export function validatePublicPath(value: string, name: string): string {
  if (!value.trim()) {
    throw new Error(`${name} is required`)
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new Error(`${name} must not contain control characters`)
  }
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('?') || value.includes('#')) {
    throw new Error(`${name} must be an absolute pathname`)
  }
  if (FORBIDDEN_PATH_CHARACTER_PATTERN.test(value)) {
    throw new Error(`${name} must not contain quotes or backslashes`)
  }
  // Router matching uses URL.pathname. Reject aliases instead of silently changing routes;
  // already encoded path segments remain byte-for-byte unchanged, including escape case.
  if (new URL(value, 'https://model-worker.invalid').pathname !== value) {
    throw new Error(`${name} must be a canonical URL pathname`)
  }
  return value
}

export function assertUniqueValues(entries: ReadonlyArray<readonly [name: string, value: string]>, kind: string): void {
  const owners = new Map<string, string>()
  for (const [name, value] of entries) {
    const existing = owners.get(value)
    if (existing) {
      // Only the conflicting variable names are reported. Embedding the raw value would leak
      // configuration values (R2 object keys, public paths) into error surfaces, which the
      // secret-free error contract forbids.
      throw new Error(`${name} must differ from ${existing}; duplicate ${kind}`)
    }
    owners.set(value, name)
  }
}
