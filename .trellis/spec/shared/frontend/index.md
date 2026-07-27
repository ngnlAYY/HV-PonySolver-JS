# Shared Frontend Guidelines（不适用）

## Scope

`@hv-pony-solver/shared` 是无 I/O 的 TypeScript 契约包，提供 model manifest 与 token normalization。它不渲染 DOM、不包含组件、hooks、样式或 frontend state。

真实实现：

- `packages/shared/src/model.ts`
- `packages/shared/src/token.ts`
- `packages/shared/src/index.ts`

## Guidelines Index

| Guide                                             | Project status                                  |
| ------------------------------------------------- | ----------------------------------------------- |
| [Directory Structure](./directory-structure.md)   | Not applicable — 使用 backend/contract 目录规范 |
| [Component Guidelines](./component-guidelines.md) | Not applicable — 无 UI 组件                     |
| [Hook Guidelines](./hook-guidelines.md)           | Not applicable — 无 hooks                       |
| [State Management](./state-management.md)         | Not applicable — package 无状态、无 I/O         |
| [Quality Guidelines](./quality-guidelines.md)     | Not applicable — 使用 backend 质量规范          |
| [Type Safety](./type-safety.md)                   | Not applicable — 使用 backend 契约类型规范      |

## Pre-Development Checklist

1. Shared 变更读取 [`../backend/index.md`](../backend/index.md)。
2. 新 API 必须保持可被 Node、Cloudflare Worker 和 Userscript 共同导入，不能依赖 DOM 或 Cloudflare runtime。
3. UI behavior 属于 `apps/userscript`；Worker HTTP behavior 属于 `apps/model-worker`。

这些文件保留是为了兼容 Trellis scaffold 路径，不表示 shared package 存在 frontend 层。
