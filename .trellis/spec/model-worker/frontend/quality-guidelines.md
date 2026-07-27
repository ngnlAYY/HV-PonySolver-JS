# Quality Guidelines（不适用）

Model Worker 的质量门禁全部属于 backend：Cloudflare Vitest pool、TypeScript、Wrangler config guard、Bearer/CORS/KV/R2 测试和发布后 contract checker。

请使用 [`../backend/quality-guidelines.md`](../backend/quality-guidelines.md)，并运行：

```bash
corepack pnpm --filter @hv-pony-solver/model-worker typecheck
corepack pnpm --filter @hv-pony-solver/model-worker test
corepack pnpm --filter @hv-pony-solver/model-worker build
```

不要为本 package 添加虚构的 component snapshot、DOM 或 hook 测试。
