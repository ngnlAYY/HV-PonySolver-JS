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
  wasmAssets: [
    {
      path: 'dist/ort-wasm-simd-threaded.asyncify.wasm',
      filename: 'ort-wasm-simd-threaded.asyncify.wasm',
      byteLength: 23_678_474,
      sha256: '66fe6d69b8835a9af0cde19533bafb09c71418bccf7c095d8c3c78f5800b01e8',
    },
    {
      path: 'dist/ort-wasm-simd-threaded.jsep.wasm',
      filename: 'ort-wasm-simd-threaded.jsep.wasm',
      byteLength: 26_239_907,
      sha256: '411b39a77bb006ce0cf17b30c978c66a130ebb2ba39c8dfdbdc9c1c5a251ae76',
    },
    {
      path: 'dist/ort-wasm-simd-threaded.jspi.wasm',
      filename: 'ort-wasm-simd-threaded.jspi.wasm',
      byteLength: 14_625_739,
      sha256: '38c52c206c5b9cf9dda318a4d7f60567b1428f75c45923e0f2c8c1b57ac58b47',
    },
    {
      path: 'dist/ort-wasm-simd-threaded.wasm',
      filename: 'ort-wasm-simd-threaded.wasm',
      byteLength: 13_022_405,
      sha256: '040d52ce5066707a10d45cb9500c35e70a9c2fb33c4fb63428da9ae45b956b97',
    },
  ],
  cdn: {
    scriptUrl: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort.min.js',
    wasmPath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/',
  },
} as const
