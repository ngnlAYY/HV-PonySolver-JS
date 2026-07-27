# 技术设计：全面优化 Round 2

## 总体形状

父任务只做协调与 R6 评估研究；R1-R5 由五个轻量子任务独立交付。每个子任务一个 PR 级别的变更面，单独可验证、可回滚。执行顺序：

```
01-security-audit-fix (R1)
  → 02-deps-routine-upgrade (R2)
      → 03-userscript-coverage-uplift (R3) ┐
04-bundle-size-budget (R4)                 ├─ 可并行
05-e2e-on-pr (R5)                          ┘
  → 父任务 R6 评估（research/major-upgrades.md）
```

## R1 — 安全审计修复

**实施方式**：根 `package.json` 的 `pnpm.overrides`（模式已存在：esbuild/js-yaml/protobufjs/vite/ws）与经用户批准的 ESLint major 升级组合完成。

- `js-yaml`: `4.2.0` → `4.3.0`（改现有 override）
- `brace-expansion`: 按实际主版本保留 v1 / v5 override；实施中确认 ESLint → minimatch@3 的 v1 链无法通过升级到 v5 兼容修复，因此升级 ESLint 9 → 10、`@eslint/js` 9 → 10，使该链迁移到 minimatch@10 → brace-expansion 5.0.8。
- `postcss`: `>=8.5.18`
- `sharp`: `>=0.35.0`
- `protobufjs`: 顺手修复 moderate 漏洞至 8.7.1。

**验证**：`pnpm install --frozen-lockfile` 可复现；`pnpm audit` 全量零漏洞；`pnpm check:quick` 全绿，确认 overrides 与 ESLint 10 未破坏 lint/test 工具链。

**风险与决策**：不得用不兼容的跨 major override 换取 audit 表面通过。brace-expansion v1 链遇到该情况时改为升级父依赖，范围变更已于 2026-07-26 获用户批准。

## R2 — 例行依赖升级

**分组升级、每组独立验证**（一组失败不阻塞其他组回退粒度）：

1. 测试工具组：vitest 4.1.10、@vitest/coverage-{v8,istanbul} 4.1.10、vite override → 8.1.5
2. Lint/format 组：typescript-eslint 8.65.0、prettier 3.9.6
3. Cloudflare 组：wrangler ^4.114.0、@cloudflare/vitest-pool-workers、@cloudflare/workers-types（`pnpm --filter model-worker update` 后跑 worker 测试）
4. 推理运行时组：onnxruntime-web 1.26.0 → 1.27.0
   - 更新 `apps/userscript` 依赖版本
   - 重新生成/更新 onnx runtime asset manifest（`onnx-runtime-assets` 脚本体系）：新 byteLength + SHA-256
   - `verify-onnx-runtime-assets` 通过；`verify-onnx-runtime-cdn` 留作发布前手动步骤并在 PR 描述注明
   - 检查 1.27.0 changelog 是否影响 WASM 文件名/结构（manifest 断言会兜底）

**不动**：R1 已完成的 ESLint 10 不在本批次继续调整；TypeScript 5.9（major）、@types/node 22（与 Node 决策联动）、esbuild override 0.28.1（除非 audit 涉及）保持不变。

**验证**：每组升级后 `pnpm check:quick`；全部完成后 `pnpm check`（含 coverage + build）。

## R3 — userscript 覆盖率提升

1. 先跑 `pnpm --filter @hv-pony-solver/userscript test:coverage` 拿当前实际值（门槛 80/80/70/80 是下限，实际可能已更高）。
2. 按覆盖率报告补薄弱模块测试；codegraph 已提示的候选：`model-downloader` 的 `createModelFetchInit` 等内部分支、`inference-types` 相关 narrow 路径、`onnx-worker-entry`（若被 istanbul/v8 统计）。
3. 把 `apps/userscript/vitest.config.ts` thresholds 提到 90/90/80/90（若实际值允许，可再高，但 PRD 底线 90/90/80/90）。
4. 禁止新增 coverage exclude 凑数；如确有不可测文件（如纯声明），在子任务 PRD 里逐条记录理由。

## R4 — bundle size budget

1. 新脚本 `scripts/check-bundle-budget.mjs` + `scripts/check-bundle-budget.test.mjs`（node:test，模式对齐现有 check-* 脚本群）。
2. 输入：构建产物路径 + 预算表（JSON 常量内置于脚本或独立配置）。两档预算：
   - `hv-pony-solver.user.js`（非捆绑、未压缩）：当前 ~72KB → 预算建议 96KB（+33% 余量）
   - bundled-runtime + minify 产物：本地实测 398,993 B，预算定为 480 KiB（491,520 B），余量 92,527 B；CI dispatch 构建执行同一预算检查
3. 接入：根 `package.json` 增加 `bundle:check`；`check:quick` 追加；CI `coverage-build` job 在 Build 步骤后运行非捆绑档；`bundled-userscript` job 运行捆绑档。
4. 脚本行为：产物缺失即失败（不静默跳过）；输出实际大小 vs 预算差值。

## R5 — E2E on PR

1. `verify-monorepo.yml` 的 `userscript-e2e` job：条件从 `workflow_dispatch && inputs.run_userscript_e2e` 改为 `pull_request || push(main) || (workflow_dispatch && inputs.run_userscript_e2e)`。
2. `bundled-userscript` job 的 needs 条件已兼容 `skipped`，改动后需重新核对 `always() && ...` 表达式仍正确。
3. Playwright Chromium 安装步骤增加浏览器缓存（`actions/cache` 按 playwright 版本 key），控制 PR 时长。
4. 实测两次 PR 运行时长与稳定性；若 >5min 或出现 flake，按 PRD 降级为 main push + nightly（`schedule` cron）并记录数据。

## R6 — major 升级评估（research 产物，不实施 TypeScript / Node 升级）

产出 `research/major-upgrades.md`，逐项记录：

- **ESLint 10 + `@eslint/js` 10**：已按用户批准并入 R1 实施；R6 仅记录 flat config、typescript-eslint 兼容性与完成结果，不再提出独立升级任务。
- **TypeScript 7.0**（5.9 → 7.0 跨度大）：评估 tsconfig strict 选项变化、esbuild/vitest/typescript-eslint 支持状态；结论为等待 TS 7.1+ 稳定 API 与 typescript-eslint 明确支持。
- **Node 24 LTS**：评估 engines/CI/`@types/node` 联动及 Wrangler、Cloudflare Vitest pool 支持；结论为先做 Node 22.13.0 + 24 双版本 CI qualification，不立即抬高最低版本。
- 每项给出：收益 / 风险 / 建议时机 / 建议的独立任务拆分。

## 回滚

- 每个子任务独立 commit（可能独立分支/PR），任何一项出问题 revert 单个 commit 即可。
- override 类改动回滚 = 还原 package.json + lockfile。
- CI workflow 改动（R5）回滚不影响代码路径。
