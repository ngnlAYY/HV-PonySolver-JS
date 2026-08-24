// The @version line carries a literal __HV_PONY_SOLVER_VERSION__ placeholder.
// It must stay verbatim inside this template literal: scripts/build-userscript.mjs
// extracts the raw text between the backticks and replaces the placeholder with
// the version declared in apps/userscript/package.json.
export const USERSCRIPT_VERSION_PLACEHOLDER = '__HV_PONY_SOLVER_VERSION__'

export const USERSCRIPT_METADATA = `// ==UserScript==
// @name        HV-PonySolver-Local
// @version     __HV_PONY_SOLVER_VERSION__
// @description 使用浏览器本地 ONNX Runtime Web 自动识别并答题小马验证码
// @include     https://hentaiverse.org/*
// @include     https://alt.hentaiverse.org/*
// @icon        https://e-hentai.org/favicon.ico
// @exclude     https://hentaiverse.org/battle_stats*
// @exclude     https://alt.hentaiverse.org/battle_stats*
// @exclude     https://hentaiverse.org/equip/*
// @exclude     https://hentaiverse.org/isekai/equip/*
// @grant       GM_registerMenuCommand
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_deleteValue
// @run-at      document-end
// ==/UserScript==`
