type ErrorLike = Readonly<{
  name?: unknown
  message?: unknown
  /**
   * Optional already-user-facing text. Errors carrying it (for example
   * PermanentModelError subclasses) are formatted verbatim instead of with the
   * class-name prefix, which would be noise in panel messages.
   */
  userMessage?: unknown
}>

function isErrorLike(error: unknown): error is ErrorLike {
  return typeof error === 'object' && error !== null
}

export function formatErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error) {
    return error
  }
  if (error === undefined || error === null) {
    return '未知错误'
  }
  if (isErrorLike(error)) {
    if (typeof error.userMessage === 'string' && error.userMessage) {
      return error.userMessage
    }
    if (error.message) {
      return error.name ? `${String(error.name)}: ${String(error.message)}` : String(error.message)
    }
    if (error.name) {
      return String(error.name)
    }
  }
  return String(error)
}
