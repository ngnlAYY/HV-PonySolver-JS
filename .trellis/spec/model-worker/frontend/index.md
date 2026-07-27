# Model Worker Frontend Guidelines（不适用）

## Scope

`@hv-pony-solver/model-worker` 是 Cloudflare Worker backend。它只暴露 Fetch API HTTP handler，不渲染 DOM、不包含组件、hooks、样式或浏览器状态。

实际入口与请求路径见：

- `apps/model-worker/src/index.ts`
- `apps/model-worker/src/request-router.ts`
- `apps/model-worker/src/model-response.ts`

## Guidelines Index

| Guide                                             | Project status                                  |
| ------------------------------------------------- | ----------------------------------------------- |
| [Directory Structure](./directory-structure.md)   | Not applicable — 使用 backend 目录规范          |
| [Component Guidelines](./component-guidelines.md) | Not applicable — 无 UI 组件                     |
| [Hook Guidelines](./hook-guidelines.md)           | Not applicable — 无 React/Vue hooks             |
| [State Management](./state-management.md)         | Not applicable — KV/R2 属于 backend persistence |
| [Quality Guidelines](./quality-guidelines.md)     | Not applicable — 使用 backend 质量规范          |
| [Type Safety](./type-safety.md)                   | Not applicable — 使用 backend TypeScript 规范   |

## Pre-Development Checklist

1. Model Worker 变更必须先读取 [`../backend/index.md`](../backend/index.md)。
2. HTTP/CORS、KV/R2、Wrangler、部署与测试规则都归入 backend。
3. 如果任务要求在 Model Worker package 中新增 DOM 或组件，先确认 package 边界；当前项目没有这种模式，通常应放在 `apps/userscript`。

这些文件保留是为了兼容 Trellis scaffold 路径，不表示本 package 存在 frontend 层。
