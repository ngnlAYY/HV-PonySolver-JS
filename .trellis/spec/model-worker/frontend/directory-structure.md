# Directory Structure（不适用）

Model Worker 没有 frontend 目录。`apps/model-worker/src/` 是 Cloudflare Worker backend，按 [`../backend/directory-structure.md`](../backend/directory-structure.md) 组织。

真实证据：

- `apps/model-worker/src/index.ts` 导出 Fetch API `fetch` handler。
- `apps/model-worker/package.json` 依赖 Cloudflare Worker 工具链，不依赖 UI framework。

不要为满足模板而创建 `components/`、`pages/`、`hooks/` 或 frontend assets。
