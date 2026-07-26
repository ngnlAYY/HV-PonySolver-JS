export const ONNX_RUNTIME_ASSETS = {
  packageName: 'onnxruntime-web',
  packageVersion: '1.27.0',
  scriptAsset: {
    path: 'dist/ort.min.js',
    filename: 'ort.min.js',
    byteLength: 360_434,
    sha256: 'de1beb9d172dbda72e56fa2f430c8e4477e97908609859ab47f89fc3e034a8d5',
    maxByteLength: 2_097_152,
  },
  wasmAssets: [
    {
      path: 'dist/ort-wasm-simd-threaded.asyncify.wasm',
      filename: 'ort-wasm-simd-threaded.asyncify.wasm',
      byteLength: 24_254_953,
      sha256: '7e83cd6cee77e478bc96a7e91b198144fb5e4126287daf1f9b54bb195ebcd55a',
    },
    {
      path: 'dist/ort-wasm-simd-threaded.jsep.wasm',
      filename: 'ort-wasm-simd-threaded.jsep.wasm',
      byteLength: 26_827_543,
      sha256: '78feeeb3d08f6bcee94d938ed322f69073bb8076b5f9d34697a574ffba8deb48',
    },
    {
      path: 'dist/ort-wasm-simd-threaded.jspi.wasm',
      filename: 'ort-wasm-simd-threaded.jspi.wasm',
      byteLength: 15_046_878,
      sha256: '7c28cdb40958a998f5aa0981d5cb8e57ac1e7e9b4d2f18a7d74e00dd9629d7a3',
    },
    {
      path: 'dist/ort-wasm-simd-threaded.wasm',
      filename: 'ort-wasm-simd-threaded.wasm',
      byteLength: 13_479_978,
      sha256: 'd1ab1b94b16a65b29d710d0b587b29e7bed336827577623913479b8afe8113e6',
    },
  ],
  cdn: {
    scriptUrl: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.min.js',
    wasmPath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/',
  },
} as const
