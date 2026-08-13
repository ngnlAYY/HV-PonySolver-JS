#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
EXTENSION_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
REPOSITORY_ROOT="$(CDPATH= cd -- "$EXTENSION_ROOT/../.." && pwd)"
FIXTURE_ROOT="$EXTENSION_ROOT/test/fixtures/packaged-model"
VENV="${PACKAGED_FIXTURE_VENV:-$REPOSITORY_ROOT/.tmp/packaged-fixture-venv}"
PIP_VERSION=26.1.1

python3 -m venv "$VENV"
# shellcheck disable=SC1091
source "$VENV/bin/activate"
python -m pip install --disable-pip-version-check "pip==$PIP_VERSION"
python -m pip install --disable-pip-version-check --require-hashes \
  -r "$REPOSITORY_ROOT/scripts/ort-runtime/requirements.txt"

rm -f "$FIXTURE_ROOT/deterministic-captcha.onnx" "$FIXTURE_ROOT/deterministic-captcha.ort"
python "$FIXTURE_ROOT/generate_fixture.py"
temporary_output="$(mktemp -d)"
trap 'rm -rf "$temporary_output"; rm -f "$FIXTURE_ROOT/deterministic-captcha.onnx"' EXIT
python -m onnxruntime.tools.convert_onnx_models_to_ort \
  --output_dir "$temporary_output" \
  --optimization_style Fixed \
  --enable_type_reduction \
  "$FIXTURE_ROOT/deterministic-captcha.onnx"
cp "$temporary_output/deterministic-captcha.ort" "$FIXTURE_ROOT/deterministic-captcha.ort"

node "$SCRIPT_DIR/write-packaged-fixture-identity.mjs"
sha256sum "$FIXTURE_ROOT/deterministic-captcha.ort"
