# 执行计划：全面优化 Round 2（父任务）

> 父任务不直接实施 R1-R5；本清单跟踪子任务编排与父任务自有工作（R6 评估、集成复核）。
> 每个子任务：create → 补 PRD → start → 实施 → check → 归档，遵循各自 PRD。

## Phase A — 子任务创建（规划批准后）

- [x] `task.py create "修复安全审计红灯" --slug security-audit-fix --parent 07-26-project-optimization-round2`
- [x] `task.py create "例行依赖升级批" --slug deps-routine-upgrade --parent 07-26-project-optimization-round2`
- [x] `task.py create "userscript 覆盖率提升" --slug userscript-coverage-uplift --parent 07-26-project-optimization-round2`
- [x] `task.py create "bundle 大小预算守卫" --slug bundle-size-budget --parent 07-26-project-optimization-round2`
- [x] `task.py create "E2E PR 常态化" --slug e2e-on-pr --parent 07-26-project-optimization-round2`
- [x] 为每个子任务写入聚焦 PRD（从父任务 R1-R5 摘取 + 验证命令）（2026-07-26 完成）

## Phase B — 串行段

- [x] 子任务 security-audit-fix（R1）：overrides + 经批准的 ESLint / `@eslint/js` 10 升级 → `pnpm audit --audit-level high` exit 0 + `check:quick` 绿 → 提交（fc0c005，且全量 audit 零漏洞）
- [x] 子任务 deps-routine-upgrade（R2）：四组升级逐组验证 → `pnpm check` 全绿 → 实现提交 d10ab05（归档提交 01fa7a9）
  - 验证命令：`corepack pnpm check:quick`（每组后）；`corepack pnpm check`（收尾）
  - onnxruntime-web 组额外：`corepack pnpm --filter @hv-pony-solver/userscript verify-onnx-runtime-assets`

## Phase C — 并行段（B 完成后，顺序不限）

- [x] 子任务 userscript-coverage-uplift（R3）：补测试 → 提门槛 90/90/80/90 → `check:userscript` 绿（6cd4b0d；实际 94.29/95.86/83.97/94.04）
- [x] 子任务 bundle-size-budget（R4）：新脚本 + 测试 + 接入 check:quick/CI → `pnpm test`（含脚本 node:test）绿（e23a833；default 72,204/98,304 B，bundled 398,993/491,520 B）
- [~] 子任务 e2e-on-pr（R5）：workflow 改造 + playwright 缓存 → 本地完成并提交 4ed834f，分支已 push；用户尚未创建 PR，因此仍等待两个 PR revision 的远程实测与 cold/hot cache 数据
- 回滚点：三个子任务各自独立 commit，互不影响

## Phase D — 父任务收尾

- [x] R6 评估写入 `research/major-upgrades.md`（TS 7：等待 TS7.1+ 与 typescript-eslint 支持；Node 24：先做 22.13+24 双版本 CI qualification；ESLint 10 已实施）
- [~] 集成复核：仓库根 `corepack pnpm check` 与全量 `pnpm audit` 已 exit 0；R1-R4、R6 本地验收已核对。跨子任务验收标准 3（PR 上 E2E）仍等待 R5 的两次远程 PR 与 cold/hot cache 数据
- [x] README 命令参考已同步 `bundle:check` 与 E2E CI 事实，`pnpm docs:check` 通过
- [x] bundle budget 与 E2E CI 可执行契约已写入 `.trellis/spec/userscript/frontend/quality-guidelines.md` 并更新对应 index
- [ ] 父任务 wrap-up：汇总各子任务提交与 R6 结论

## Review Gates

- Gate 1（现在）：用户批准本规划 + Open Questions 三项答复
- Gate 2（B 段后）：audit 绿灯 + 升级批完成，确认进入并行段
- Gate 3（D 段前）：R3 / R4 已归档；R5 仅本地实现完成，必须等待两次远程 PR 与 cold/hot cache 验收后才能归档并进入父任务 wrap-up
