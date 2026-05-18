const TAG = '[PonySolverLocal]'
const DEBUG_STORAGE_KEY = 'hvPonySolverDebug'

function isDebugEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(DEBUG_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export const log = (...args: unknown[]): void => {
  if (isDebugEnabled()) {
    console.log(TAG, ...args)
  }
}
export const warn = (...args: unknown[]): void => console.warn(TAG, ...args)
export const logError = (...args: unknown[]): void => console.error(TAG, ...args)
