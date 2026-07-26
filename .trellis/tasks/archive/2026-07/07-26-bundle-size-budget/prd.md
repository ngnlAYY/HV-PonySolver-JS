# bundle 大小预算守卫

> 父任务：07-26-project-optimization-round2（R4）。轻量任务，PRD-only。无前置依赖。

## Goal

新增 userscript 产物大小预算检查，防止 bundle 无感膨胀；接入本地 check 与 CI。

## Requirements

1. 新增 `scripts/check-bundle-budget.mjs` + `scripts/check-bundle-budget.test.mjs`（node:test），风格对齐现有 check-* 脚本群（纯 ESM、可测试导出、明确退出码）。
2. 两档预算：
   - 非捆绑未压缩 `hv-pony-solver.user.js`：当前 ~72KB，预算 96KB
   - bundled-runtime + minify 产物：首次在 CI 实测后定值（预留 +20% 余量）；实测前脚本对该档允许「配置缺省即跳过但打印警告」，实测后必须钉值
3. 行为：目标产物不存在时失败（不静默跳过）；输出实际大小、预算与差值。
4. 接入：根 package.json 增加 `bundle:check` script；`check:quick` 链尾追加；CI `coverage-build` job 在 Build 后运行非捆绑档；`bundled-userscript` job 运行捆绑档。
5. README 命令参考同步新增命令，过 `docs:check`。
6. 注意：`check:quick` 当前不产出构建产物，需在脚本中先确保产物存在（构建或明确报错提示先 build）——设计取舍记录在实现说明里。

## 验收标准

- [x] `node --test scripts/check-bundle-budget.test.mjs` 通过，并纳入根 `pnpm test` 的脚本测试链
- [x] 产物超预算时脚本 exit 非 0，输出可定位差值
- [x] `corepack pnpm check:quick` 全绿（含新检查）
- [x] CI workflow 变更通过 YAML 解析与完整仓库检查（环境未安装 actionlint）

## 验证命令

```bash
node --test scripts/check-bundle-budget.test.mjs
corepack pnpm --filter @hv-pony-solver/userscript build && corepack pnpm bundle:check
corepack pnpm check:quick
```

## 完成记录（2026-07-26）

- 当前分支实测：default 72,204 B，预算 96 KiB，余量 26,100 B；bundled+minify 398,993 B，预算 480 KiB，余量 92,527 B。
- 新 CLI：`--profile default|bundled`，可选 `--file` / `--repo-root`；缺文件、超预算、非法参数和原型继承 profile 均非零失败。
- 根 `bundle:check` 显式先 build；两个 profile-specific 命令保持纯检查。
- CI 在 default build 与 bundled build 后分别立即运行对应 profile。
- 完整 `pnpm check` 通过；11/11 新 Node tests 通过；独立 `trellis-check` 修复了 `__proto__` profile 边界。
- actionlint 未安装；已通过 YAML 解析、Prettier、仓库完整检查。
- 长期命令与 CI 契约已沉淀至 `.trellis/spec/userscript/frontend/quality-guidelines.md`。
