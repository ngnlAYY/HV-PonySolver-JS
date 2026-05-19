declare const __HV_PONY_SOLVER_WORKER_SCRIPT__: string | undefined

const TEST_WORKER_SCRIPT_KEY = '__HV_PONY_SOLVER_TEST_WORKER_SCRIPT__'
const WORKER_RUNTIME_SOURCE_PLACEHOLDER = '__HV_PONY_SOLVER_WORKER_RUNTIME_SOURCE_PLACEHOLDER__'
const WORKER_RUNTIME_SOURCE_PLACEHOLDER_LITERAL = JSON.stringify(WORKER_RUNTIME_SOURCE_PLACEHOLDER)

type WorkerScriptGlobal = typeof globalThis & Record<typeof TEST_WORKER_SCRIPT_KEY, string | undefined>

export function createOnnxWorkerScript(runtimeSource?: string): string {
  const script = typeof __HV_PONY_SOLVER_WORKER_SCRIPT__ === 'string'
    ? __HV_PONY_SOLVER_WORKER_SCRIPT__
    : (globalThis as WorkerScriptGlobal)[TEST_WORKER_SCRIPT_KEY]
  if (!script) {
    throw new Error('__HV_PONY_SOLVER_WORKER_SCRIPT__ is not defined')
  }
  return script.replace(WORKER_RUNTIME_SOURCE_PLACEHOLDER_LITERAL, () => JSON.stringify(runtimeSource ?? ''))
}
