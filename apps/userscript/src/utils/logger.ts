import { isDebugEnabled } from '../userscript/debug-settings'

const TAG = '[PonySolverLocal]'

export const log = (...args: unknown[]): void => {
  if (isDebugEnabled()) {
    console.log(TAG, ...args)
  }
}
export const warn = (...args: unknown[]): void => console.warn(TAG, ...args)
export const logError = (...args: unknown[]): void => console.error(TAG, ...args)
