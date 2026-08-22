import { describe, expect, it } from 'vitest'

import { ModelAccessKeyRejectedError, ModelDownloadQuotaExceededError } from '../../src/model/model-download-error'
import { ModelIntegrityVerificationError, isPermanentModelError } from '../../src/model/permanent-model-error'
import { formatErrorMessage } from '../../src/utils/errors'

describe('permanent model error classification', () => {
  it('recognizes every permanent model failure as non-retryable', () => {
    expect(isPermanentModelError(new ModelAccessKeyRejectedError())).toBe(true)
    expect(isPermanentModelError(new ModelDownloadQuotaExceededError(null))).toBe(true)
    expect(isPermanentModelError(new ModelIntegrityVerificationError('下载模型 SHA-256 校验失败'))).toBe(true)
    expect(isPermanentModelError(new Error('模型下载失败: HTTP 500'))).toBe(false)
    expect(isPermanentModelError('模型离线')).toBe(false)
    expect(isPermanentModelError(null)).toBe(false)
  })

  it('preserves the concrete error names used in status messages', () => {
    expect(new ModelAccessKeyRejectedError().name).toBe('ModelAccessKeyRejectedError')
    expect(new ModelDownloadQuotaExceededError(60).name).toBe('ModelDownloadQuotaExceededError')
    expect(new ModelIntegrityVerificationError('校验失败').name).toBe('ModelIntegrityVerificationError')
  })

  it('formats permanent model errors without the class-name prefix', () => {
    expect(formatErrorMessage(new ModelAccessKeyRejectedError())).toBe('模型 Key 无效或已失效，请在设置中重新验证 Key')
    expect(formatErrorMessage(new ModelIntegrityVerificationError('下载模型 SHA-256 校验失败'))).toBe(
      '下载模型 SHA-256 校验失败',
    )
  })
})
