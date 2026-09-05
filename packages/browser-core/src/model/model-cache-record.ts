import { isRecordObject } from '../utils/guards'
import { modelConfig } from './model-config'
import { MODEL_CONFIRMATION_KEY } from './model-cache-schema'
import type { ModelIntegrityOptions } from './model-integrity'
import { resolveIntegrityOptions, verifyModelIntegrity } from './model-integrity'

export async function createCachedModelRow(
  buffer: ArrayBuffer,
  options: ModelIntegrityOptions = {},
  confirmationPending: boolean = false,
): Promise<Record<string, unknown>> {
  const { integrity, verifyIntegrity } = resolveIntegrityOptions(options)
  if (verifyIntegrity) {
    await verifyModelIntegrity(buffer, integrity, '缓存写入模型')
  }
  return {
    key: modelConfig.cacheKey,
    version: modelConfig.version,
    byteLength: integrity.byteLength,
    sha256: integrity.sha256,
    buffer,
    confirmationPending,
    updatedAt: Date.now(),
  }
}

export async function readCachedModelBuffer(
  row: unknown,
  options: ModelIntegrityOptions = {},
  confirmationRow?: unknown,
): Promise<ArrayBuffer | null> {
  const { integrity, verifyIntegrity } = resolveIntegrityOptions(options)
  if (!isRecordObject(row) || row.version !== modelConfig.version || !(row.buffer instanceof ArrayBuffer)) {
    return null
  }
  // Remote-model rows remain fail-closed until the receipt POST succeeds.
  // Legacy rows lack proof of that state, so an upgrade intentionally causes
  // one fresh, confirmable download instead of preserving an ambiguous cache.
  if ('cacheWriteId' in row) {
    if (
      typeof row.cacheWriteId !== 'string' ||
      !row.cacheWriteId ||
      !isRecordObject(confirmationRow) ||
      confirmationRow.key !== MODEL_CONFIRMATION_KEY ||
      confirmationRow.cacheWriteId !== row.cacheWriteId ||
      confirmationRow.confirmationPending !== false ||
      confirmationRow.version !== row.version ||
      confirmationRow.byteLength !== row.byteLength ||
      confirmationRow.sha256 !== row.sha256
    )
      return null
  } else if (row.confirmationPending !== false) {
    return null
  }
  if (row.byteLength !== integrity.byteLength || row.sha256 !== integrity.sha256) {
    return null
  }
  if (!verifyIntegrity) {
    return row.buffer
  }
  try {
    await verifyModelIntegrity(row.buffer, integrity, '缓存模型')
    return row.buffer
  } catch {
    return null
  }
}
