export {
  hasAllowedKeys,
  hasExactKeys as hasOnlyKeys,
  isRecordObject as isRecord,
} from '@hv-pony-solver/browser-core/utils/guards'

export const PROTOCOL_VERSION = 'hv-pony-solver/2' as const
export const CONTENT_PORT_NAME = 'hv-pony-solver:content' as const
export const OPTIONS_PORT_NAME = 'hv-pony-solver:options' as const
export const OFFSCREEN_MESSAGE_TYPE = 'hv-pony-solver:offscreen-request' as const

export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value)
}

export { isRequestId as isEpoch }

export function isGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}
