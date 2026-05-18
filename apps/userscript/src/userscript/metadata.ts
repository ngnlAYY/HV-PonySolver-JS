export const USERSCRIPT_METADATA = `// ==UserScript==
// @name        HV-PonySolver-Local
// @version     3.0.0
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
// @connect     cdn.jsdelivr.net
// @connect     models.ngnl.host
// ==/UserScript==`
