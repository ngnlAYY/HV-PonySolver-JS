# 全面优化项目：新一轮审计与改进（父任务）

## Goal

基于 2026-07-26 对 monorepo 的全面审计，修复当前唯一的 CI 红灯（安全审计），完成一轮低风险依赖升级，并在测试覆盖、产物守卫与工程基线上各前进一步。父任务持有需求全集与子任务映射；实际交付由子任务承担。

## 审计基线（2026-07-26）

- `pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿（本地验证 exit 0）。
- `pnpm audit --audit-level high` **失败（exit 1）**：7 high + 2 moderate，全部为 devDependencies 传递依赖：
  - `brace-expansion`（3 条路径：eslint、typescript-eslint 等，需 >=1.1.16 / >=5.0.8）
  - `js-yaml` >=4.0.0 <4.3.0（现有根 override 钉在 4.2.0，本身即漏洞版本）
  - `postcss` <=8.5.17（经 vitest coverage）
  - `sharp` <0.35.0（经 model-worker 的 wrangler 链）
  - CI `verify-monorepo.guardrails` 与 `deploy-cloudflare-model-worker` 的 Security audit step 均会因此失败。
- 依赖过时：
  - patch/minor：vitest 4.1.6→4.1.10、prettier 3.8.3→3.9.6、typescript-eslint 8.59.3→8.65.0、vite 8.0.16→8.1.5（root override 钉住）、wrangler 4.102→4.114、onnxruntime-web 1.26.0→1.27.0
  - major（高风险）：初始计划均只评估、不实施；后续根据 R1 安全修复结论与用户批准，eslint 9→10、@eslint/js 9→10 已并入 R1 实施。TypeScript 5.9→7.0 与 Node 24 LTS（`@types/node` 随运行时基线联动）仍只评估、不实施。
- 覆盖率门槛不对齐：userscript 80/80/70/80，低于 model-worker 100/100/90/100 与 shared 100/100/100/100。
- E2E Playwright smoke 仅 `workflow_dispatch` 手动触发，PR 上不运行。
- 构建已产出 byteLength/sha256/metafile，但无 bundle 大小预算守卫；`benchmark:inference` 存在但无基线记录。

## Requirements

### R1 — 恢复安全审计绿灯（P0）

`pnpm audit --audit-level high` 必须 exit 0。优先用根 `pnpm.overrides` 修传递依赖（沿用现有 override 模式），必要时升级父依赖。实施中确认 brace-expansion v1 链无法通过兼容 override 真修复后，按用户批准把 ESLint / `@eslint/js` 10 升级并入 R1。不得放宽 CI 的 `audit:high` 门禁、不得忽略（ignore）漏洞替代修复。

### R2 — 例行依赖升级批（P1）

完成 patch/minor 升级：vitest 系、prettier、typescript-eslint、vite（同步更新 override）、wrangler、@cloudflare/*、onnxruntime-web 1.27.0。onnxruntime-web 升级必须同步更新本地 asset manifest（byteLength/SHA-256），并通过 `verify-onnx-runtime-assets`；CDN 校验（`verify-onnx-runtime-cdn`）在发布前手动执行。升级后 `pnpm check` 全绿。

### R3 — userscript 覆盖率提升（P2）

userscript 覆盖率门槛提升到不低于 90/90/80/90（lines/functions/branches/statements），并补齐达标所需测试。不得用排除文件的方式凑数（新增 exclude 需逐条说明理由）。

### R4 — 产物大小预算守卫（P2）

新增 userscript bundle size budget 检查：未压缩非捆绑产物与（CI 中的）minify+bundled-runtime 产物各有上限，超限即失败。预算值以当前实测大小加合理余量确定，写入可测试的脚本（沿用 scripts/*.mjs + node:test 模式）并接入 CI 与 `check:quick`。

### R5 — E2E 在 PR 上常态化（P2）

Playwright smoke 从仅手动触发改为 PR 常态运行（独立 job，不阻塞现有 guardrails/test job 的并行度）。若实测不稳定或耗时过长（>5 分钟），允许降级为 main push + nightly，需在 PR 描述中记录实测数据与决策。

### R6 — 剩余 major 升级评估（P3，仅评估不实施）

对 TypeScript 7、Node 24 LTS 与匹配运行时基线的 `@types/node` 产出评估结论（兼容性、收益、风险、建议时机），落入本任务 research/。ESLint 10 已按批准并入 R1 实施，R6 只记录其完成结果；TypeScript / Node 的实施留待后续独立任务。

## Out of Scope

- 07-24-fix-authorized-model-download 的全部范围（线上部署恢复、部署后契约检查器 R3-R5）——由该任务负责。
- 00-bootstrap-guidelines 的 spec 填充与 model-worker/frontend 模板清理——由该任务负责。
- Model Worker Core 拆分（README guardrail 明确不拆）。
- 模型缓存策略 / versioned URL（前置条件见 docs/model-cache-strategy.md，未满足）。
- TypeScript 7 / Node 24 的实际升级实施；ESLint 10 已按用户批准并入 R1，不属于此项 Out of Scope。

## 子任务映射

| 子任务                        | 需求 | 类型             | 依赖                               |
| ----------------------------- | ---- | ---------------- | ---------------------------------- |
| 01-security-audit-fix         | R1   | 轻量（PRD-only） | 无                                 |
| 02-deps-routine-upgrade       | R2   | 轻量（PRD-only） | 依赖 01 完成（避免 override 冲突） |
| 03-userscript-coverage-uplift | R3   | 轻量（PRD-only） | 建议在 02 之后（vitest 版本稳定）  |
| 04-bundle-size-budget         | R4   | 轻量（PRD-only） | 无                                 |
| 05-e2e-on-pr                  | R5   | 轻量（PRD-only） | 无                                 |
| （父任务内）major 升级评估    | R6   | research 产物    | 在 01/02 之后                      |

03 / 04 / 05 相互独立，可并行。

## 跨子任务验收标准

1. `corepack pnpm check`（含 audit 前提下的 check:quick + coverage + build）在仓库根全绿。
2. `pnpm audit --audit-level high` exit 0。
3. CI `verify-monorepo` 三个常规 job（guardrails/test/coverage-build）+ 新增 E2E job 在 PR 上全绿。
4. 无任何 CI 门禁被放宽（audit level、覆盖率阈值只升不降、guardrail 脚本不删）。
5. R6 评估结论已写入父任务 research/ 并在 wrap-up 时汇报。

## Decisions（2026-07-26 用户确认）

1. R3 门槛定为 90/90/80/90。
2. R5 采用 PR 常态化（加 Playwright 浏览器缓存；实测不稳定或 >5min 再降级并记录数据）。
3. R6 维持只评估：Node 24 / TS 7 本轮不实施。
4. 计划整体批准，执行从子任务 01 开始。
5. **修订（同日）**：eslint 10 升级并入子任务 01——brace-expansion v1 链无上游补丁且 override 因 CJS API 不兼容不可行，eslint 10 是 audit 变绿的唯一真手段；用户批准。R6 评估范围相应缩为 TS 7 + Node 24。
