#!/usr/bin/env bash
set -euo pipefail

ORT_TAG=v1.27.0
ORT_COMMIT=8f0278c77bf44b0cc83c098c6c722b92a36ac4b5
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
BUILD_ROOT="${ORT_BUILD_ROOT:-$HOME/.cache/hv-pony-ort-v1.27.0}"
ORT_SOURCE="$BUILD_ROOT/onnxruntime"
MODEL_INPUT="$BUILD_ROOT/model-input"
MODEL_OUTPUT="$BUILD_ROOT/model-output"
BUILD_DIR="$BUILD_ROOT/build"
RUNTIME_OUTPUT_DIR="${ORT_RUNTIME_OUTPUT_DIR:-$ROOT_DIR/other}"
INSTALL=0

if [[ "${1:-}" == "--install" ]]; then
  INSTALL=1
elif [[ $# -gt 0 ]]; then
  printf 'Usage: %s [--install]\n' "$0" >&2
  exit 2
fi

mkdir -p "$BUILD_ROOT"
if [[ ! -d "$ORT_SOURCE/.git" ]]; then
  git clone --depth 1 --branch "$ORT_TAG" --recurse-submodules --shallow-submodules \
    https://github.com/microsoft/onnxruntime.git "$ORT_SOURCE"
fi
actual_commit="$(git -C "$ORT_SOURCE" rev-parse HEAD)"
if [[ "$actual_commit" != "$ORT_COMMIT" ]]; then
  printf 'Unexpected ONNX Runtime commit: expected=%s actual=%s\n' "$ORT_COMMIT" "$actual_commit" >&2
  exit 1
fi

python3 -m venv "$BUILD_ROOT/venv"
# shellcheck disable=SC1091
source "$BUILD_ROOT/venv/bin/activate"
python -m pip install 'onnxruntime==1.27.0' 'onnx==1.20.1' 'flatbuffers>=25,<26'
rm -rf "$MODEL_INPUT" "$MODEL_OUTPUT"
mkdir -p "$MODEL_INPUT" "$MODEL_OUTPUT"
cp "$ROOT_DIR/model/yolo26n-640.onnx" "$MODEL_INPUT/yolo26n-640.onnx"
python -m onnxruntime.tools.convert_onnx_models_to_ort \
  --output_dir "$MODEL_OUTPUT" \
  --optimization_style Fixed \
  --enable_type_reduction \
  "$MODEL_INPUT"

cd "$ORT_SOURCE"
./build.sh \
  --config MinSizeRel \
  --build_dir "$BUILD_DIR" \
  --build_wasm \
  --enable_wasm_simd \
  --disable_wasm_exception_catching \
  --minimal_build \
  --include_ops_by_config "$MODEL_OUTPUT/required_operators_and_types.config" \
  --enable_reduced_operator_type_support \
  --disable_ml_ops \
  --disable_rtti \
  --disable_exceptions \
  --compile_no_warning_as_error \
  --skip_tests \
  --parallel "${ORT_BUILD_JOBS:-8}"

mkdir -p "$ORT_SOURCE/js/web/dist"
cp "$BUILD_DIR/MinSizeRel/ort-wasm-simd.mjs" "$ORT_SOURCE/js/web/dist/ort-wasm-simd-threaded.mjs"
node - "$ORT_SOURCE/js/web/script/build.ts" <<'NODE'
const fs = require('node:fs')
const path = process.argv[2]
let source = fs.readFileSync(path, 'utf8')
source = source.replace('if (matches.length !== 1) {', 'if (matches.length > 1) {')
const startNeedle = "  if (BUNDLE_MODE === 'prod') {\n    // ort.all"
const endNeedle = "  if (BUNDLE_MODE === 'dev' || BUNDLE_MODE === 'perf')"
const start = source.indexOf(startNeedle)
if (start >= 0) {
  const end = source.indexOf(endNeedle, start)
  if (end < 0) throw new Error('Unable to isolate ONNX Runtime production bundle block')
  const replacement = `  if (BUNDLE_MODE === 'prod') {
    await buildOrt({
      isProduction: true,
      outputName: 'ort.wasm.bundle',
      format: 'esm',
      define: {
        ...DEFAULT_DEFINE,
        'BUILD_DEFS.DISABLE_JSEP': 'true',
        'BUILD_DEFS.DISABLE_WEBNN': 'true',
        'BUILD_DEFS.DISABLE_WEBGL': 'true',
        'BUILD_DEFS.DISABLE_WASM_PROXY': 'true',
        'BUILD_DEFS.ENABLE_BUNDLE_WASM_JS': 'true',
      },
    });
  }

`
  source = source.slice(0, start) + replacement + source.slice(end)
}
if (!source.includes('void addAllWebBuildTasks;')) {
  source = source.replace(
    "  if (BUNDLE_MODE === 'node' || BUNDLE_MODE === 'prod') {",
    "  void addAllWebBuildTasks;\n\n  if (BUNDLE_MODE === 'node' || BUNDLE_MODE === 'prod') {",
  )
}
fs.writeFileSync(path, source)
NODE

NPM_CONFIG_USERCONFIG=/dev/null npm --prefix "$ORT_SOURCE/js" ci --ignore-scripts --no-audit --no-fund
NPM_CONFIG_USERCONFIG=/dev/null npm --prefix "$ORT_SOURCE/js" run prepare
NPM_CONFIG_USERCONFIG=/dev/null npm --prefix "$ORT_SOURCE/js/common" ci --ignore-scripts --no-audit --no-fund
NPM_CONFIG_USERCONFIG=/dev/null npm --prefix "$ORT_SOURCE/js/common" run prepare
NPM_CONFIG_USERCONFIG=/dev/null npm --prefix "$ORT_SOURCE/js/web" ci --ignore-scripts --no-audit --no-fund
NPM_CONFIG_USERCONFIG=/dev/null npm --prefix "$ORT_SOURCE/js/web" run prepare
NPM_CONFIG_USERCONFIG=/dev/null npm --prefix "$ORT_SOURCE/js/web" run build -- --bundle-mode=prod

ARTIFACT_DIR="$BUILD_ROOT/artifacts"
rm -rf "$ARTIFACT_DIR"
mkdir -p "$ARTIFACT_DIR"
cp "$MODEL_OUTPUT/yolo26n-640.ort" "$ARTIFACT_DIR/"
cp "$MODEL_OUTPUT/required_operators_and_types.config" "$ARTIFACT_DIR/"
WASM_SOURCE="$BUILD_DIR/MinSizeRel/ort-wasm-simd.wasm"
WASM_SHA256="$(sha256sum "$WASM_SOURCE" | awk '{print $1}')"
WASM_FILENAME="ort-wasm-simd-${WASM_SHA256}.wasm"
cp "$WASM_SOURCE" "$ARTIFACT_DIR/$WASM_FILENAME"
cp "$ORT_SOURCE/js/web/dist/ort.wasm.bundle.min.mjs" "$ARTIFACT_DIR/"
mkdir -p "$RUNTIME_OUTPUT_DIR"
cp "$WASM_SOURCE" "$RUNTIME_OUTPUT_DIR/$WASM_FILENAME"
cp "$ORT_SOURCE/js/web/dist/ort.wasm.bundle.min.mjs" "$RUNTIME_OUTPUT_DIR/"

if [[ "$INSTALL" == 1 ]]; then
  install -Dm644 "$ARTIFACT_DIR/ort.wasm.bundle.min.mjs" \
    "$ROOT_DIR/apps/userscript/vendor/onnxruntime/ort.wasm.bundle.min.mjs"
  install -Dm644 "$ARTIFACT_DIR/required_operators_and_types.config" \
    "$ROOT_DIR/config/onnxruntime/required_operators_and_types.config"
fi

printf 'Generated artifacts in %s\n' "$ARTIFACT_DIR"
printf 'Copied minimal runtime to %s\n' "$RUNTIME_OUTPUT_DIR"
printf 'R2 runtime object key: runtime/%s\n' "$WASM_FILENAME"
sha256sum "$ARTIFACT_DIR"/*
