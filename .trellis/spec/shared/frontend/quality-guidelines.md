# Quality Guidelines（不适用）

Shared package 的质量规则集中在 backend pure-contract 规范：无 I/O、依赖方向、canonical manifest/token contract、100% coverage thresholds 与 consumer 回归。

请使用 [`../backend/quality-guidelines.md`](../backend/quality-guidelines.md)，并运行：

```bash
corepack pnpm check:shared
corepack pnpm architecture:check
```

不要添加虚构的 component、hook、DOM 或 browser E2E gate。
