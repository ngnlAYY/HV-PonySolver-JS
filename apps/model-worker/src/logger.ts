// Production observability helper. Log output is restricted to non-sensitive categorical
// fields (route, error kind, error name) via the closed field type and a runtime allowlist.
// Free-form messages, raw values, tokens, and object keys must never reach this module, so
// callers pass classification fields only and never interpolate caught error messages.

const LOG_TAG = 'model-worker'
const ALLOWED_FIELD_NAMES: ReadonlySet<string> = new Set(['route', 'errorKind', 'errorName'])
// eslint-disable-next-line no-control-regex -- These code points are the sanitization target.
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

export type WorkerLogRoute = 'legacy-model' | 'ort-model' | 'runtime' | 'request'

export type WorkerLogFields = Readonly<{
  route: WorkerLogRoute
  errorKind: string
  errorName: string
}>

export function workerErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown'
}

function sanitizeFieldValue(value: string): string {
  return value.replace(CONTROL_CHARACTER_PATTERN, ' ')
}

function formatFields(fields: WorkerLogFields): string {
  return Object.entries(fields)
    .filter(([name]) => ALLOWED_FIELD_NAMES.has(name))
    .map(([name, value]) => `${name}=${sanitizeFieldValue(String(value))}`)
    .join(' ')
}

export function logWorkerWarning(fields: WorkerLogFields): void {
  console.warn(`${LOG_TAG} warn ${formatFields(fields)}`)
}

export function logWorkerError(fields: WorkerLogFields): void {
  console.error(`${LOG_TAG} error ${formatFields(fields)}`)
}
