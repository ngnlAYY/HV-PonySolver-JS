# E2E PR 常态化

> 父任务：07-26-project-optimization-round2（R5）。轻量任务，PRD-only。无前置依赖。

## Goal

Playwright smoke（`test:e2e:userscript`）从仅 workflow_dispatch 手动触发改为 PR 常态运行，控制时长与稳定性。

## Requirements

1. `verify-monorepo.yml` 的 `userscript-e2e` job 触发条件改为：`pull_request`、`push`(main)、以及保留 `workflow_dispatch && inputs.run_userscript_e2e`。
2. 独立 job，不改变 guardrails/test/coverage-build 的并行结构。
3. 增加 Playwright Chromium 浏览器缓存（`actions/cache`，key 含 @playwright/test 版本），减少每次安装耗时。
4. 复核 `bundled-userscript` job 的 `needs`/`if` 表达式：条件变化后 `userscript-e2e` 在 dispatch 场景可能为 success 而非 skipped，`always() && ...` 逻辑必须仍正确。
5. 用户决策（2026-07-26）：PR 常态化优先；若实测 flake 或 job >5 分钟，降级为 main push + nightly（schedule），并在提交说明记录实测数据。
6. README 中 E2E 相关描述如有事实变化，过 `docs:check`。

## 验收标准

- [ ] PR 事件触发 userscript-e2e job 并通过（远程待验证）
- [ ] Playwright 浏览器缓存命中时安装步骤显著缩短（远程 cold/hot 数据待验证）
- [x] `bundled-userscript` 在 dispatch 场景的表达式矩阵已复核并记录
- [ ] 实测两次 PR 运行：时长与稳定性数据记录到提交说明或本 PRD Notes（远程待验证）

## 验证命令

```bash
corepack pnpm test:e2e:userscript      # 本地先验证 smoke 本身可跑
# workflow 语法：按仓库现有 CI 校验方式
```

## Notes

### 本地验证（2026-07-27）

- 触发矩阵：PR 与 main push 运行；dispatch input=true 运行，false skipped；push 其他分支在顶层不触发 workflow。
- bundled 矩阵：dispatch + bundle=true 时，input=false 要求 E2E skipped；input=true 要求 E2E success；failure 阻断 bundled/artifact。
- Playwright cache：`~/.cache/ms-playwright`，key=`playwright-${runner.os}-chromium-${strict-semver}`；cache hit 后仍执行 `install --with-deps chromium`。
- 本地 smoke 两次通过：3.775s、3.092s（1 test）；但因本机缺 Playwright-managed Chromium，使用临时 `/usr/bin/chromium` executable shim，不能替代远程 managed-browser/cache 证据。
- 完整 `pnpm check`、docs drift、YAML parse、Prettier、git diff check 全绿；actionlint 未安装。
- 独立 `trellis-check` 严格化 Playwright `Version <semver>` 输出解析，并将受 README 格式影响的 docs fixture 改为 whitespace-tolerant 正则。
- E2E CI 可执行契约已沉淀到 `.trellis/spec/userscript/frontend/quality-guidelines.md`。

### 远程待办

1. 分支 `chore/optimization-round2` 已推送至 origin（2026-07-27）；用户选择不创建 PR，因此本次 push 不触发 E2E。
2. 后续创建/更新 PR 后，记录两个 revision 的 `userscript-e2e` 结果与总时长。
3. 记录 cold-cache / hot-cache 的 Chromium install 时长。
4. 若 flake 或 >5 分钟，按用户决策降级到 main push + nightly。
