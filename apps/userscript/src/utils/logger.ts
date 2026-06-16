const TAG = '[PonySolverLocal]'

export const warn = (...args: unknown[]): void => console.warn(TAG, ...args)
export const logError = (...args: unknown[]): void => console.error(TAG, ...args)
