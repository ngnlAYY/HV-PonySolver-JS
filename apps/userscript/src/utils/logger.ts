const TAG = '[PonySolverLocal]'

export const log = (...args: unknown[]): void => console.log(TAG, ...args)
export const warn = (...args: unknown[]): void => console.warn(TAG, ...args)
export const logError = (...args: unknown[]): void => console.error(TAG, ...args)
