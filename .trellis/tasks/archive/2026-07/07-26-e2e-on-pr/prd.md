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
7. **验收方式修订（2026-07-27）**：用户明确要求不创建 PR，直接推送远程并触发对应构建。因此用同一远程分支/head SHA 的两次顺序 `workflow_dispatch`（E2E + bundled-runtime）验证真实 GitHub runner、managed Chromium、cold/hot cache 与稳定性；PR 触发条件保留静态表达式复核，不再要求实际创建 PR。

## 验收标准

- [x] 远程 GitHub runner 上的 userscript-e2e 两次通过；PR/main/dispatch 触发矩阵已静态复核（按用户要求不创建实际 PR）
- [x] Playwright Chromium 冷/热缓存已验证：安装 22s → 11s，E2E job 63s → 31s
- [x] `bundled-userscript` 在两次远程 dispatch 中均成功，表达式矩阵已复核
- [x] 两次远程完整 workflow 均成功，无 flake且远低于 5 分钟；run IDs 与步骤数据记录于 Notes

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

### 远程验证（2026-07-27）

远程分支：`origin/chore/optimization-round2`，head SHA：`0f0b06e48d4756758ebb6087165e3c3c47c191ca`。两次均使用：

```text
bundle_onnx_runtime=true
publish_userscript_artifact=false
run_userscript_e2e=true
```

| Run | URL | Cache | E2E job | Chromium install | Smoke | 完整 workflow | 结果 |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| `30232888062` | https://github.com/ngnlAYY/HV-PonySolver-JS/actions/runs/30232888062 | cold：`Cache not found`，结束后保存 `playwright-Linux-chromium-1.60.0` | 63s | 22s | 4s | 94s | 全部 jobs success |
| `30232999410` | https://github.com/ngnlAYY/HV-PonySolver-JS/actions/runs/30232999410 | hot：命中并恢复同一 primary key，不重复保存 | 31s | 11s | 6s | 77s | 全部 jobs success |

- 两次 `validate-inputs`、`guardrails`、`test`、`coverage-build`、`userscript-e2e`、`bundled-userscript` 全绿。
- 热缓存使 Chromium install 从 22s 降至 11s（-50%），E2E job 从 63s 降至 31s（约 -51%）。
- 两次均无 flake且远低于 5 分钟，不触发 main push + nightly 降级方案。
- 按用户最新要求未创建 PR；PR/main 事件条件由 workflow 表达式与独立检查复核，真实 runner/cache/build 由上述两次 dispatch 验证。
