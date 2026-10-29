type ErrorLike = Readonly<{
  name?: unknown
  message?: unknown
  /** 已面向用户的文案，直接显示，不加错误类名前缀。 */
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
  try {
    if (isErrorLike(error)) {
      const userMessage = error.userMessage
      if (typeof userMessage === 'string' && userMessage) {
        return userMessage
      }
      const message = error.message
      const name = error.name
      if (message) {
        return name ? `${String(name)}: ${String(message)}` : String(message)
      }
      if (name) {
        return String(name)
      }
    }
    return String(error)
  } catch {
    return '未知错误'
  }
}
