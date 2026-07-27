# Bootstrap Guidelines：技术设计

## 目标

把 `trellis init` 生成的通用模板替换为 HV Pony Solver 当前代码库的真实约定，使后续 `trellis-implement` 与 `trellis-check` 能从 `.trellis/spec/` 直接获得可执行、可验证的上下文。

## 信息来源

按以下优先级提取事实：

1. 仓库内 `README.md`、现有运维文档、package scripts 与工具配置；先验证文档链接存在，当前不能把缺失的 `CONTRIBUTING.md` 当作事实来源。
2. TypeScript/ESLint/Prettier/Vitest/Cloudflare/Userscript 构建配置。
3. 当前源码与测试中的重复模式；每项适用规则至少引用 2 个真实文件或 symbol。
4. 已在项目优化任务中验证的 bundle、E2E、部署与安全 guardrails。

不把通用框架建议、未来重构愿望或当前代码不存在的技术写成规范。

## Spec 层映射

### `model-worker/backend`

完整填写：

- `directory-structure.md`：入口、env normalization、router、access decision、response、scripts、tests。
- `database-guidelines.md`：将模板的“数据库”语义改写为本项目真实的 Cloudflare KV/R2 persistence 边界；明确没有 ORM/SQL/migration。
- `error-handling.md`：HTTP status、CORS/no-store、env fail-closed、selected object missing 和 CLI `cause`。
- `logging-guidelines.md`：Worker 正常响应不记录 Key/body；CLI/Actions 只输出非秘密摘要和可定位差异。
- `quality-guidelines.md`：Bearer/CORS/KV/R2、Wrangler render guard、离线测试、post-deploy checker。
- `index.md`：列出 pre-development checklist 和各文件 Completed 状态。

### `model-worker/frontend`

Model Worker 没有 DOM、组件、hook 或客户端状态。保留 index 与模板文件名以兼容 Trellis scaffold，但每个文件改为明确的 Not applicable 页面，指向 `../backend/`；不得杜撰 UI 规范。

### `userscript/frontend`

完整填写并把 React 模板术语映射到 vanilla TypeScript userscript：

- `directory-structure.md`：bootstrap、GM bridge、model、inference worker、question/status UI、styles、test/scripts。
- `component-guidelines.md`：DOM controller/render ownership、event listener 生命周期、textContent/受审计 innerHTML。
- `hook-guidelines.md`：明确无 React hooks；记录 polling、MutationObserver、GM menu、Worker request lifecycle 等副作用边界。
- `state-management.md`：GM storage、IndexedDB model cache、module/controller state、Worker session state。
- `type-safety.md`：readonly message unions、unknown/narrowing、ArrayBuffer/transferables、DOM/Worker globals。
- `quality-guidelines.md`：保留既有 bundle/E2E 契约，补齐 lint、测试、完整性、browser sink 和 review checklist。
- `index.md`：列出 pre-development checklist 和 Completed 状态。

### `shared/backend`

完整填写纯契约层：model manifest、token normalization/lookup keys、immutable constants/types、无 I/O 与无 app 反向依赖、Vitest 边界测试。数据库与日志文件明确为“不拥有存储/日志”，并说明调用方职责。

### `shared/frontend`

Shared package 没有 UI。与 Model Worker frontend 相同，保留兼容文件并明确 Not applicable，指向 `../backend/`。

### `guides`

通用 thinking guides 已由 Trellis 预填，本任务不改；只有与本项目明确冲突时才调整。

## 文档结构约定

每个适用 guideline 包含：

1. Scope / Overview。
2. Actual rules。
3. Real examples（repo-relative clickable path，可带 symbol/line）。
4. Forbidden patterns / common mistakes。
5. Validation commands 或 review checklist。

Index 必须提供“Pre-Development Checklist”，使 agent 知道按变更类型读取哪些文件；状态不得再是 `To fill` / `Partial`。

## 安全边界

规范必须保留并强调：

- 模型 Key只通过 `Authorization: Bearer`，不进入 URL、日志、fixture 或文档实例值。
- 不用特权 GM HTTP API绕过 CORS。
- 不关闭模型/ONNX Runtime byteLength 与 SHA-256 校验。
- Worker 公开响应 `no-store`，CORS 精确回显允许 Origin。
- post-deploy checker 只使用无 Key `OPTIONS`/`HEAD`，失败不自动回滚。
- Shared package 不导入 app 层。

## 验证

- 搜索并拒绝剩余 `(To be filled by the team)`、`To fill`、模板 HTML comments 和不适用的通用 React/ORM 指令。
- 验证所有 Markdown 相对链接与引用的真实文件存在。
- `corepack pnpm exec prettier --check .trellis/spec`
- `corepack pnpm docs:check`
- `corepack pnpm check`
- 独立审查每项规则是否可由源码/测试支持，是否包含真实示例且未泄露 credential。
