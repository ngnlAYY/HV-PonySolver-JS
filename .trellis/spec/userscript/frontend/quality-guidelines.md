# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

### 场景：Userscript bundle 大小预算守卫

#### 1. Scope / Trigger

当 userscript 的源码、构建配置、ONNX Runtime 资源或依赖变化可能影响发布产物大小时，必须运行 bundle budget gate；新增构建 profile 时必须同时定义其预算与 CI 检查点。

#### 2. Signatures

```text
pnpm bundle:check
pnpm bundle:check:default
pnpm bundle:check:bundled
node scripts/check-bundle-budget.mjs --profile <default|bundled> [--file <path>] [--repo-root <path>]
```

- `bundle:check`：显式构建默认 userscript 后调用 default 纯检查。
- `bundle:check:default` / `bundle:check:bundled`：只检查已存在的产物，不执行构建。

#### 3. Contracts

| Profile | 构建契约 | 预算 | 默认产物 |
| --- | --- | ---: | --- |
| `default` | 未压缩、不内置 ONNX Runtime JS | 96 KiB | `apps/userscript/dist/hv-pony-solver.user.js` |
| `bundled` | `--minify` + bundled-runtime | 480 KiB | `apps/userscript/dist/hv-pony-solver.user.js` |

成功输出必须包含 `profile`、`actual`、`budget`、`delta` 和绝对 `file` 路径。`check:quick` 调用 `bundle:check`；CI 的 `coverage-build` 在默认 build 后调用 default profile，`bundled-userscript` 在 bundled build 后调用 bundled profile。

#### 4. Validation & Error Matrix

| 条件 | 行为 |
| --- | --- |
| profile 不在 `default` / `bundled`（包括 `__proto__` 等继承属性） | 非零退出，报告 `Unknown bundle budget profile` |
| `--profile` / `--file` / `--repo-root` 缺值 | 非零退出，报告对应 flag requires a value |
| 产物不存在或目标不是普通文件 | 非零退出，输出 `actual=missing` 与先构建提示；包装错误保留 `cause` |
| `actualBytes` / `budgetBytes` 非非负 safe integer | 抛出参数验证错误 |
| `actualBytes > budgetBytes` | 非零退出，输出正数 overage delta |
| `actualBytes <= budgetBytes` | 零退出，输出剩余预算（负数或零 delta） |

#### 5. Good / Base / Bad Cases

- Good：构建命令完成后立即运行对应 profile，产物小于预算，CI 继续。
- Base：产物恰好等于预算，允许通过（`delta=0`）。
- Bad：在 bundled build 后误跑 default profile，或 pure checker 遇到缺失产物却静默跳过。

#### 6. Tests Required

`node --test scripts/check-bundle-budget.test.mjs` 至少断言：

- 两个 profile 的固定预算；恰好等于预算与超过预算的边界。
- 缺文件、未知参数、未知 profile 和原型继承 profile 的非零失败。
- CLI 成功/失败输出同时含 profile、actual、budget、delta。
- CI workflow 中两个 profile 位于各自构建步骤之后。

仓库级验收必须运行 `pnpm check`，并单独实测 bundled build + `pnpm bundle:check:bundled`。

#### 7. Wrong vs Correct

```yaml
# Wrong：默认构建后检查 bundled 预算，过宽预算会掩盖默认产物膨胀
- run: pnpm build
- run: pnpm bundle:check:bundled

# Correct：每种构建紧跟对应 profile
- run: pnpm build
- run: pnpm bundle:check:default
```

```json
// Wrong：让纯 checker 隐式构建，CI 无法看出被检查的产物来源
"bundle:check:default": "pnpm build && node scripts/check-bundle-budget.mjs --profile default"

// Correct：build-and-check 与 pure-check 命令分离
"bundle:check": "pnpm --filter @hv-pony-solver/userscript build && pnpm bundle:check:default",
"bundle:check:default": "node scripts/check-bundle-budget.mjs --profile default"
```

### 场景：Userscript E2E CI gate

#### 1. Scope / Trigger

修改 userscript 启动、DOM 扫描、模型/Worker 初始化、答案提交、构建产物或 E2E fixture 时，PR 与 `main` push 必须运行 Playwright smoke；发布型 workflow dispatch 可由显式 input 控制是否运行。

#### 2. Signatures

```text
pnpm test:e2e:userscript
pnpm --filter @hv-pony-solver/userscript exec playwright --version
pnpm --filter @hv-pony-solver/userscript exec playwright install --with-deps chromium
```

GitHub Actions job：`verify-monorepo.yml#userscript-e2e`。缓存版本 step id 固定为 `playwright-version`，output 名为 `version`。

#### 3. Contracts

- `pull_request`：E2E job 必须运行。
- `push`：workflow 顶层只接受 `main`，E2E job 必须运行。
- `workflow_dispatch`：仅 `inputs.run_userscript_e2e=true` 时运行。
- Chromium 缓存路径为 `~/.cache/ms-playwright`；key 必须包含 `runner.os`、`chromium` 和严格解析的 Playwright semver。
- 即使 cache hit，仍运行 `playwright install --with-deps chromium`，保证 Ubuntu system dependencies。
- `bundled-userscript` 仅允许 workflow dispatch：input=false 时接受 E2E=`skipped`，input=true 时只接受 E2E=`success`；E2E failure 不得发布 artifact。

#### 4. Validation & Error Matrix

| 条件 | 行为 |
| --- | --- |
| Playwright 输出严格匹配 `Version <semver>` | 写入 `$GITHUB_OUTPUT`，用于 cache key |
| 输出为空、多行或非 semver | version step 失败，不使用污染的 output |
| PR / main push | E2E job 运行，bundled publish job 不运行 |
| dispatch + `run_userscript_e2e=false` | E2E skipped；满足其他条件时 bundled job 可运行 |
| dispatch + `run_userscript_e2e=true` + E2E success | bundled job 可运行 |
| dispatch + `run_userscript_e2e=true` + E2E failure | bundled job skipped，不能发布 artifact |

#### 5. Good / Base / Bad Cases

- Good：PR 冷缓存成功，后续 revision 命中相同 Playwright 版本缓存，两个 E2E job 都稳定且各自 <5 分钟。
- Base：dispatch 不请求 E2E，E2E skipped，但请求的 bundled build 仍可执行。
- Bad：用 `continue-on-error` 放过 E2E failure；或只以 lockfile 通用 hash 作 cache key而不显式包含 Playwright 版本。

#### 6. Tests Required

- 本地：`pnpm test:e2e:userscript` 通过并发现 Chromium smoke test。
- 仓库：`pnpm check`、`pnpm docs:check`、workflow YAML parse 与格式检查通过。
- 远程：至少两个 PR revision 的 `userscript-e2e` 成功；记录 cold/hot cache、安装耗时和 job 总耗时。
- 若 remote job flake 或 >5 分钟，改为 `main` push + nightly，并在任务/PR 中保留实测依据。

#### 7. Wrong vs Correct

```yaml
# Wrong：PR 不跑，或 E2E 失败仍继续发布
if: ${{ github.event_name == 'workflow_dispatch' }}
continue-on-error: true

# Correct：PR/main 常态运行，dispatch 显式 opt-in
if: ${{ github.event_name == 'pull_request' || github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.run_userscript_e2e) }}
```

```yaml
# Wrong：缓存 key 不反映 Playwright/browser revision
key: playwright-${{ runner.os }}

# Correct：使用严格解析的实际版本
key: playwright-${{ runner.os }}-chromium-${{ steps.playwright-version.outputs.version }}
```

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
