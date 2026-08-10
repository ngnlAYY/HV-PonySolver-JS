export const ONNX_RUNTIME_ASSETS = {
  packageName: 'onnxruntime-web',
  packageVersion: '1.27.0',
  sourceCommit: '8f0278c77bf44b0cc83c098c6c722b92a36ac4b5',
  emsdkVersion: '4.0.23',
  operatorConfigSha256: '2abe2e2987496ab518de97a7f4b157cec1bd1817c621d3523073034fb47591fe',
  externalFullRuntime: {
    scriptUrl: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.min.js',
    wasmBaseUrl: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/',
  },
  bundleAsset: {
    path: 'apps/userscript/vendor/onnxruntime/ort.wasm.bundle.min.mjs',
    filename: 'ort.wasm.bundle.min.mjs',
    byteLength: 56_993,
    sha256: 'a63d4f08e70220c0f721fabfd4e4b958aa127334a19038b2732d07e919f32554',
    maxByteLength: 96_000,
  },
  wasmAsset: {
    filename: 'ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm',
    publicPath: '/runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm',
    url: 'https://models.ngnl.host/runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm',
    objectKey: 'runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm',
    byteLength: 1_267_937,
    sha256: '25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa',
    maxByteLength: 2_000_000,
  },
} as const
