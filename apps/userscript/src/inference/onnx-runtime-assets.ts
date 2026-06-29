export const ONNX_RUNTIME_ASSETS = {
  packageName: 'onnxruntime-web',
  packageVersion: '1.26.0',
  scriptAsset: {
    path: 'dist/ort.min.js',
    filename: 'ort.min.js',
    byteLength: 360_388,
    sha256: 'ba5e52f4a87f823a700fa5eb916fd5946b970999e8e0518334b116f7b03bd53d',
    maxByteLength: 2_097_152,
  },
  cdn: {
    scriptUrl: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort.min.js',
    wasmPath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/',
  },
} as const
