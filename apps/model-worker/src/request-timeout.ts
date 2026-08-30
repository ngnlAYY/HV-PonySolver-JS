export const MODEL_WORKER_DEPENDENCY_TIMEOUT_MS = 5_000

export function withModelWorkerDependencyTimeout<T>(operation: PromiseLike<T>, dependencyName: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${dependencyName} dependency timed out`))
    }, MODEL_WORKER_DEPENDENCY_TIMEOUT_MS)
  })

  return Promise.race([Promise.resolve(operation), timeout]).finally(() => clearTimeout(timeoutId))
}
