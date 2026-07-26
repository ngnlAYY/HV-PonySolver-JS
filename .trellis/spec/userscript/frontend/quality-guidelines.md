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

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
