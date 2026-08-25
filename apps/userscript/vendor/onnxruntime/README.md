# Custom ONNX Runtime Web bundle

`ort.wasm.bundle.min.mjs` embeds the JavaScript API and the Emscripten glue from ONNX Runtime Web `1.27.0`.
It does not embed the WebAssembly binary.

Provenance:

- ONNX Runtime commit: `8f0278c77bf44b0cc83c098c6c722b92a36ac4b5`
- Emscripten SDK: `4.0.23`
- Build: `MinSizeRel`, basic minimal, SIMD, single-thread, reduced operator types
- Operator config: `config/onnxruntime/required_operators_and_types.config`
- Bundle SHA-256: `a63d4f08e70220c0f721fabfd4e4b958aa127334a19038b2732d07e919f32554`
- Matching WASM SHA-256: `25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa`

The matching WASM is fetched from the content-addressed first-party URL declared in
`src/inference/onnx-runtime-assets.ts`, verified before use, and supplied through
`ort.env.wasm.wasmBinary`.

Run `pnpm build:onnx-runtime` to reproduce the isolated artifacts. Pass `--install` to replace the tracked bundle and
regenerate the Git-ignored operator config only after reviewing the printed hashes.
