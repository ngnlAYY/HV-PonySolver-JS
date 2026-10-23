import { sha256Hex } from '../platform/byte-stream'
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

export async function verifyModelIntegrity(
  buffer: ArrayBuffer,
  integrity: ModelIntegrity,
  source: string,
): Promise<void> {
  if (buffer.byteLength !== integrity.byteLength) {
    throw new ModelIntegrityVerificationError(`${source}大小校验失败: ${buffer.byteLength} != ${integrity.byteLength}`)
  }
  const sha256 = await sha256Hex(buffer)
  if (sha256 !== integrity.sha256) {
    throw new ModelIntegrityVerificationError(`${source} SHA-256 校验失败`)
  }
}
