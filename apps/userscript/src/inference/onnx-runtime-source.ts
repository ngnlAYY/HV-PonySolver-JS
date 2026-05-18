declare const __HV_PONY_SOLVER_ONNX_RUNTIME_SOURCE__: string | undefined

export function getBundledOnnxRuntimeSource(): string | undefined {
  if (typeof __HV_PONY_SOLVER_ONNX_RUNTIME_SOURCE__ === 'string' && __HV_PONY_SOLVER_ONNX_RUNTIME_SOURCE__.length > 0) {
    return __HV_PONY_SOLVER_ONNX_RUNTIME_SOURCE__
  }
  return undefined
}
