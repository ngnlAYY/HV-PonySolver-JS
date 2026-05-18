# Userscript

The userscript app lives in `apps/userscript` and builds a single generated file:

```text
apps/userscript/dist/hv-pony-solver.user.js
```

The generated userscript metadata keeps `@name        HV-PonySolver-Local`; only the artifact file name changed.

## Build

```bash
pnpm --filter @hv-pony-solver/userscript build
```

## Source Layout

- `src/app` wires lifecycle and captcha observation.
- `src/captcha` detects captcha DOM, loads the image, solves, and submits answers.
- `src/inference` manages ONNX Runtime Web Worker inference and YOLO output parsing.
- `src/model` downloads and caches the ONNX model.
- `src/persistence` stores recent answer history in localStorage.
- `src/status-panel` renders runtime status and history.
- `src/userscript` stores userscript metadata.
