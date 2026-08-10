declare const __HV_PONY_SOLVER_WORKER_SCRIPT__: string

const TEST_WORKER_SCRIPT_GLOBAL = '__HV_PONY_SOLVER_TEST_WORKER_SCRIPT__'

export function createOnnxWorkerScript(): string {
  const testWorkerScript = (globalThis as Record<string, unknown>)[TEST_WORKER_SCRIPT_GLOBAL]
  if (typeof testWorkerScript === 'string') {
    return testWorkerScript
  }

  return __HV_PONY_SOLVER_WORKER_SCRIPT__
}
