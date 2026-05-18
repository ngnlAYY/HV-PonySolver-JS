export const USERSCRIPT_METADATA = `// ==UserScript==
// @name        HV-PonySolver-Local
// @version     3.0.0
// @description 使用浏览器本地 ONNX Runtime Web 自动识别并答题小马验证码
// @include     http*://hentaiverse.org/*
// @include     http*://alt.hentaiverse.org/*
// @icon        https://e-hentai.org/favicon.ico
// @exclude     http*://hentaiverse.org/battle_stats*
// @exclude     http*://alt.hentaiverse.org/battle_stats*
// @exclude     http*://hentaiverse.org/equip/*
// @exclude     http*://hentaiverse.org/isekai/equip/*
// @grant       none
// @run-at      document-end
// @connect     raw.githubusercontent.com
// @connect     cdn.jsdelivr.net
// @connect     models.ngnl.host
// ==/UserScript==`
