type ErrorLike = Readonly<{
  name?: unknown
  message?: unknown
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
    if (error.message) {
      return error.name ? `${String(error.name)}: ${String(error.message)}` : String(error.message)
    }
    if (error.name) {
      return String(error.name)
    }
  }
  return String(error)
}
