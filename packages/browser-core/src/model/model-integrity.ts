import { modelConfig } from './model-config'
import { ModelIntegrityVerificationError } from './permanent-model-error'

export type ModelIntegrity = Readonly<{
  byteLength: number
  sha256: string
}>

export type ModelIntegrityOptions = Readonly<{
  accessKeyOverride?: string
  integrity?: ModelIntegrity
  verifyIntegrity?: boolean
  forceVerifyIntegrity?: boolean
}>

export function resolveIntegrityOptions(options: ModelIntegrityOptions = {}): {
  integrity: ModelIntegrity
  verifyIntegrity: boolean
  forceVerifyIntegrity: boolean
} {
  return {
    integrity: options.integrity ?? modelConfig.integrity,
    verifyIntegrity: options.forceVerifyIntegrity ? true : (options.verifyIntegrity ?? modelConfig.verifyIntegrity),
    forceVerifyIntegrity: options.forceVerifyIntegrity ?? false,
  }
}

export async function computeModelSha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function verifyModelIntegrity(
  buffer: ArrayBuffer,
  integrity: ModelIntegrity,
  source: string,
): Promise<void> {
  if (buffer.byteLength !== integrity.byteLength) {
    throw new ModelIntegrityVerificationError(`${source}大小校验失败: ${buffer.byteLength} != ${integrity.byteLength}`)
  }
  const sha256 = await computeModelSha256(buffer)
  if (sha256 !== integrity.sha256) {
    throw new ModelIntegrityVerificationError(`${source} SHA-256 校验失败`)
  }
}
