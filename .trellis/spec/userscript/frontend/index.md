# Userscript Frontend Guidelines

## Overview

`@hv-pony-solver/userscript` 是 vanilla TypeScript userscript：直接操作 DOM，使用 GM API、IndexedDB、Web Worker、OffscreenCanvas 与 ONNX Runtime Web；没有 React/Vue/Svelte、TSX、framework hooks 或全局 state library。

## Guidelines Index

| Guide                                             | Description                                                               | Status    |
| ------------------------------------------------- | ------------------------------------------------------------------------- | --------- |
| [Directory Structure](./directory-structure.md)   | Feature modules、composition root、Worker/build/test boundaries           | Completed |
| [Component Guidelines](./component-guidelines.md) | DOM controller/renderer ownership、styles 与 safe HTML                    | Completed |
| [Lifecycle Guidelines](./hook-guidelines.md)      | 无 framework hooks；observers、timers、menus、Worker async cancellation   | Completed |
| [State Management](./state-management.md)         | Controller state、GM storage、IndexedDB、Worker session/history ownership | Completed |
| [Quality Guidelines](./quality-guidelines.md)     | Tests/coverage、integrity、browser sinks、bundle/E2E/CI gates             | Completed |
| [Type Safety](./type-safety.md)                   | Strict TS、readonly message unions、ports、runtime guards                 | Completed |

## Pre-Development Checklist

1. Bootstrap/feature wiring：Directory + Lifecycle + State。
2. DOM/status/settings UI：Component + Lifecycle + Type Safety + Quality。
3. Model URL/Key/download/cache：State + Type Safety + Quality；保持 Bearer/CORS/完整性边界。
4. Inference/Worker/message protocol：Directory + Lifecycle + Type Safety + Quality。
5. Build/runtime assets/dependencies：Quality（bundle、browser sink、ONNX assets、E2E）。
6. Shared contract 变化：同时读取 [`../../shared/backend/index.md`](../../shared/backend/index.md)。

## Non-Negotiable Safety Boundaries

- 模型 Key仅通过 `Authorization: Bearer`；不进入 URL/query、log、fixture、task artifact 或聊天。
- 不使用 `GM_xmlhttpRequest` / `GM.xmlHttpRequest` 绕过 CORS。
- 不关闭 model/ONNX Runtime byteLength 与 SHA-256 校验。
- Worker init 消息不携带动态 runtime script URL；remote runtime 只来自 canonical config。
- 新 browser sinks 需要显式审计并更新 guard，不用 allowlist 掩盖不可信 data flow。

## Required Commands

```bash
corepack pnpm check:userscript
corepack pnpm browser-sinks:check
corepack pnpm architecture:check
```

跨层或发布行为变更最终运行 `corepack pnpm check`，必要时追加 `corepack pnpm test:e2e:userscript` 与 bundled build/budget。
