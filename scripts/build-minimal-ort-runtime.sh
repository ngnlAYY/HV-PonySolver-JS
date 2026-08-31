#!/usr/bin/env bash
set -euo pipefail

ORT_TAG=v1.27.0
ORT_COMMIT=8f0278c77bf44b0cc83c098c6c722b92a36ac4b5
PIP_VERSION=26.1.1
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PYTHON_REQUIREMENTS="$ROOT_DIR/scripts/ort-runtime/requirements.txt"
BUILD_ROOT="$(node "$ROOT_DIR/scripts/resolve-ort-build-root.mjs" "${ORT_BUILD_ROOT:-$HOME/.cache/hv-pony-ort-v1.27.0}")"
ORT_SOURCE="$BUILD_ROOT/onnxruntime"
MODEL_INPUT="$BUILD_ROOT/model-input"
MODEL_OUTPUT="$BUILD_ROOT/model-output"
BUILD_DIR="$BUILD_ROOT/build"
JS_BUILD_ROOT="$BUILD_ROOT/js-build"
RUNTIME_OUTPUT_DIR="${ORT_RUNTIME_OUTPUT_DIR:-$ROOT_DIR/other}"
ORT_BUILD_SCRIPT="$JS_BUILD_ROOT/web/script/build.ts"
INSTALL=0
BUILD_ROOT_ID=

assert_build_root_identity() {
  local current_root current_id
  current_root="$(node "$ROOT_DIR/scripts/resolve-ort-build-root.mjs" "$BUILD_ROOT")" || return 1
  current_id="$(stat -Lc '%d:%i' -- "$BUILD_ROOT")" || return 1
  if [[ "$current_root" != "$BUILD_ROOT" || "$current_id" != "$BUILD_ROOT_ID" ]]; then
    printf 'Refusing to mutate replaced ORT build root: %s\n' "$BUILD_ROOT" >&2
    return 1
  fi
}

remove_build_paths() {
  local target
  assert_build_root_identity || return 1
  for target in "$@"; do
    if [[ "$target" != "$BUILD_ROOT/"* || -L "$target" ]]; then
      printf 'Refusing to remove unsafe ORT build path: %s\n' "$target" >&2
      return 1
    fi
  done
  rm -rf -- "$@"
}

cleanup_js_build_root() {
  remove_build_paths "$JS_BUILD_ROOT"
}

if [[ "${1:-}" == "--install" ]]; then
  INSTALL=1
elif [[ $# -gt 0 ]]; then
  printf 'Usage: %s [--install]\n' "$0" >&2
  exit 2
fi

if ! command -v flock >/dev/null 2>&1; then
  printf 'The ORT build requires flock to guard its shared build root.\n' >&2
  exit 1
fi
mkdir -p -- "$BUILD_ROOT"
created_build_root="$(node "$ROOT_DIR/scripts/resolve-ort-build-root.mjs" "$BUILD_ROOT")"
if [[ "$created_build_root" != "$BUILD_ROOT" ]]; then
  printf 'Refusing replaced ORT build root: expected=%s actual=%s\n' "$BUILD_ROOT" "$created_build_root" >&2
  exit 1
fi
BUILD_ROOT_ID="$(stat -Lc '%d:%i' -- "$BUILD_ROOT")"
exec {ORT_BUILD_LOCK_FD}>"$BUILD_ROOT/.build.lock"
if ! flock -n "$ORT_BUILD_LOCK_FD"; then
  printf 'Another ORT build is already using %s\n' "$BUILD_ROOT" >&2
  exit 1
fi
assert_build_root_identity
if [[ ! -d "$ORT_SOURCE/.git" ]]; then
  git clone --depth 1 --branch "$ORT_TAG" --recurse-submodules --shallow-submodules \
    https://github.com/microsoft/onnxruntime.git "$ORT_SOURCE"
fi
actual_commit="$(git -C "$ORT_SOURCE" rev-parse HEAD)"
if [[ "$actual_commit" != "$ORT_COMMIT" ]]; then
  printf 'Unexpected ONNX Runtime commit: expected=%s actual=%s\n' "$ORT_COMMIT" "$actual_commit" >&2
  exit 1
fi
node "$ROOT_DIR/scripts/assert-clean-ort-source.mjs" "$ORT_SOURCE"
cleanup_js_build_root
mkdir -p "$JS_BUILD_ROOT"
trap cleanup_js_build_root EXIT
cp -a "$ORT_SOURCE/js/." "$JS_BUILD_ROOT/"

python3 -m venv "$BUILD_ROOT/venv"
# shellcheck disable=SC1091
source "$BUILD_ROOT/venv/bin/activate"
python -m pip install --disable-pip-version-check "pip==$PIP_VERSION"
python -m pip install --disable-pip-version-check --require-hashes -r "$PYTHON_REQUIREMENTS"
python --version
python -m pip --version
sha256sum "$PYTHON_REQUIREMENTS"
remove_build_paths "$MODEL_INPUT" "$MODEL_OUTPUT"
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

mkdir -p "$JS_BUILD_ROOT/web/dist"
cp "$BUILD_DIR/MinSizeRel/ort-wasm-simd.mjs" "$JS_BUILD_ROOT/web/dist/ort-wasm-simd-threaded.mjs"
node - "$ORT_BUILD_SCRIPT" <<'NODE'
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

NPM_CONFIG_USERCONFIG=/dev/null npm --prefix "$JS_BUILD_ROOT" ci --ignore-scripts --no-audit --no-fund
NPM_CONFIG_USERCONFIG=/dev/null npm --prefix "$JS_BUILD_ROOT" run prepare
NPM_CONFIG_USERCONFIG=/dev/null npm --prefix "$JS_BUILD_ROOT/common" ci --ignore-scripts --no-audit --no-fund
NPM_CONFIG_USERCONFIG=/dev/null npm --prefix "$JS_BUILD_ROOT/common" run prepare
NPM_CONFIG_USERCONFIG=/dev/null npm --prefix "$JS_BUILD_ROOT/web" ci --ignore-scripts --no-audit --no-fund
NPM_CONFIG_USERCONFIG=/dev/null npm --prefix "$JS_BUILD_ROOT/web" run prepare
NPM_CONFIG_USERCONFIG=/dev/null npm --prefix "$JS_BUILD_ROOT/web" run build -- --bundle-mode=prod

ARTIFACT_DIR="$BUILD_ROOT/artifacts"
remove_build_paths "$ARTIFACT_DIR"
mkdir -p "$ARTIFACT_DIR"
cp "$MODEL_OUTPUT/yolo26n-640.ort" "$ARTIFACT_DIR/"
cp "$MODEL_OUTPUT/required_operators_and_types.config" "$ARTIFACT_DIR/"
WASM_SOURCE="$BUILD_DIR/MinSizeRel/ort-wasm-simd.wasm"
WASM_SHA256="$(sha256sum "$WASM_SOURCE" | awk '{print $1}')"
WASM_FILENAME="ort-wasm-simd-${WASM_SHA256}.wasm"
cp "$WASM_SOURCE" "$ARTIFACT_DIR/$WASM_FILENAME"
cp "$JS_BUILD_ROOT/web/dist/ort.wasm.bundle.min.mjs" "$ARTIFACT_DIR/"
mkdir -p "$RUNTIME_OUTPUT_DIR"
cp "$WASM_SOURCE" "$RUNTIME_OUTPUT_DIR/$WASM_FILENAME"

if [[ "$INSTALL" == 1 ]]; then
  install -Dm644 "$ARTIFACT_DIR/ort.wasm.bundle.min.mjs" \
    "$ROOT_DIR/apps/userscript/vendor/onnxruntime/ort.wasm.bundle.min.mjs"
  install -Dm644 "$ARTIFACT_DIR/required_operators_and_types.config" \
    "$ROOT_DIR/config/onnxruntime/required_operators_and_types.config"
fi

cleanup_js_build_root
trap - EXIT
node "$ROOT_DIR/scripts/assert-clean-ort-source.mjs" "$ORT_SOURCE"

printf 'Generated artifacts in %s\n' "$ARTIFACT_DIR"
printf 'Copied minimal runtime to %s\n' "$RUNTIME_OUTPUT_DIR"
printf 'R2 runtime object key: runtime/%s\n' "$WASM_FILENAME"
sha256sum "$ARTIFACT_DIR"/*
