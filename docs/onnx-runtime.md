# Minimal ONNX Runtime Web

The current userscript uses only the ORT-format model. Existing userscript releases continue to request the legacy
ONNX path; the Model Worker keeps both exact routes and does not redirect or negotiate formats.

## Runtime profiles

The default `build` profile does not embed ONNX Runtime. Its Blob Worker loads the complete official browser runtime
from the version-pinned URLs below, configures one WASM thread, and does not fall back to the minimal runtime:

- `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.min.js`
- `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/`

The explicit `build:bundled-runtime` profile embeds the project-built minimal JS glue. Its Worker downloads only the
content-addressed minimal WASM from `models.ngnl.host`, verifies byte length and SHA-256, and assigns it to
`ort.env.wasm.wasmBinary`. Both profiles use the same remotely downloaded ORT model and the WASM execution provider;
there is no runtime or model-format fallback.

## Minimal runtime profile

The runtime is built from ONNX Runtime `v1.27.0` at commit
`8f0278c77bf44b0cc83c098c6c722b92a36ac4b5` with:

- basic minimal ORT-format support
- CPU/WASM execution provider only
- WebAssembly SIMD and one thread
- no JSEP, WebGPU, WebNN, training, ML operators, RTTI, or exceptions
- reduced operators and element types generated from `model/yolo26n-640.onnx`

The matching Emscripten glue is embedded only by `build:bundled-runtime`.

## R2 objects

Upload these exact bytes; do not rename the WASM without also changing its content-addressed manifest:

| Request path                                                                                   | R2 object key                                                                                 |      Size | SHA-256                                                            |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------: | ------------------------------------------------------------------ |
| `/yolo26n-640.ort`                                                                             | `real/yolo26n-640.ort`                                                                        | 9,914,448 | `4e771776d9356679539ffed53ee40ea012394f9b586aa92a76267e8fee38094c` |
| `/runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm` | `runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm` | 1,267,937 | `25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa` |

The ORT route uses the same Bearer/KV authorization and decoy behavior as the legacy ONNX route. The WASM route is
public, exact-path only, and responds with immutable caching.

## Reproduction

Run:

```bash
pnpm build:onnx-runtime
```

Artifacts are written under `${ORT_BUILD_ROOT:-$HOME/.cache/hv-pony-ort-v1.27.0}/artifacts`. The minimal WASM filename
contains its SHA-256 and can be uploaded directly under the printed `runtime/<filename>` R2 object key. The command
performs no R2 upload and no Worker deployment. `pnpm build:onnx-runtime -- --install` additionally replaces the
tracked glue bundle and regenerates the Git-ignored `config/onnxruntime/required_operators_and_types.config`; update
the manifest hashes deliberately if the output changes.
