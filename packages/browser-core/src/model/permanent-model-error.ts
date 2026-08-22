/**
 * Model failures that an immediate retry cannot fix.
 *
 * This module is deliberately edition-neutral so both the remote and packaged
 * builds can classify them: packaged builds throw integrity variants, while
 * remote editions additionally throw Key and quota variants defined next to
 * the downloader.
 */
export class PermanentModelError extends Error {
  /**
   * The constructor message is already complete user-facing text, so error
   * formatters render this verbatim instead of prefixing the class name.
   */
  readonly userMessage: string

  constructor(message: string) {
    super(message)
    this.name = 'PermanentModelError'
    this.userMessage = message
  }
}

export class ModelIntegrityVerificationError extends PermanentModelError {
  constructor(message: string) {
    super(message)
    this.name = 'ModelIntegrityVerificationError'
  }
}

export function isPermanentModelError(error: unknown): boolean {
  return error instanceof PermanentModelError
}
