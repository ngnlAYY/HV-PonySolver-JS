# 例行依赖升级批

> 父任务：07-26-project-optimization-round2（R2）。轻量任务，PRD-only。
> **前置**：07-26-security-audit-fix 已完成（避免 override 冲突）。

## Goal

完成一轮 patch/minor 依赖升级，保持全部检查绿灯。ESLint 10 已由前置 R1 完成；TS 7 / Node 运行时基线及其 `@types/node` 联动升级明确不在本任务范围。

## Requirements

分四组升级，每组独立验证（`check:quick`），一组出问题可单独回退：

1. **测试工具组**：vitest 4.1.6→4.1.10、@vitest/coverage-v8 / @vitest/coverage-istanbul 同步、root override vite 8.0.16→8.1.5
2. **Lint/format 组**：typescript-eslint 8.59.3→8.65.0、prettier 3.8.3→3.9.6
3. **Cloudflare 组**：wrangler ^4.102→^4.114、@cloudflare/vitest-pool-workers、@cloudflare/workers-types（升级后必须跑 model-worker 测试）
4. **推理运行时组**：onnxruntime-web 1.26.0→1.27.0
   - 同步更新 onnx runtime asset manifest（byteLength / SHA-256）
   - `verify-onnx-runtime-assets` 必须通过
   - `verify-onnx-runtime-cdn` 留作发布前手动步骤，在提交说明中注明
   - 若 1.27.0 的 WASM 资产结构变化导致 manifest 体系需要结构性改动，暂停并回报（可能升格为独立任务）

约束：不再调整前置 R1 已升级的 ESLint 10；保持 typescript 5.9、@types/node 22、esbuild override 0.28.1；README 命令/版本事实如有变化需过 `docs:check`。

## 验收标准

- [x] 四组升级全部完成或有明确记录的例外
- [x] `corepack pnpm check` 全绿（含 coverage 与 build）
- [x] `corepack pnpm --filter @hv-pony-solver/userscript verify-onnx-runtime-assets` 通过
- [x] `pnpm audit --audit-level high` 仍为 exit 0（实际为全量 audit 零漏洞）

## 验证命令

```bash
corepack pnpm check:quick   # 每组升级后
corepack pnpm check         # 全部完成后
corepack pnpm --filter @hv-pony-solver/userscript verify-onnx-runtime-assets
```

## 完成记录（2026-07-26）

- 测试组：Vitest / coverage 4.1.10，Vite 8.1.5。
- Lint/format 组：typescript-eslint 8.65.0，Prettier 3.9.6。
- Cloudflare 组：Wrangler 4.114.0、vitest pool 0.16.20、workers-types 4.20260702.1。
- 推理运行时组：onnxruntime-web 1.27.0；五项 JS/WASM 资产的 byteLength 与 SHA-256 已同步并校验。
- 独立 `trellis-check` 结论：通过，0 个缺陷；`pnpm check`、frozen-lockfile、docs drift、model-worker test 与 audit 均通过。
- 未执行：`verify-onnx-runtime-cdn`（按需求保留为发布前手动联网校验）。
- Spec 更新评估：无需更新；本次只有版本与其现有 manifest 指纹的例行变化，没有新增长期命令/API/跨层契约或工程约定。
