# 修复安全审计红灯

> 父任务：07-26-project-optimization-round2（R1）。轻量任务，PRD-only。

## Goal

`pnpm audit --audit-level high` 恢复 exit 0，解除 CI guardrails 与 deploy workflow 的审计门禁红灯。

## 现状

7 high + 2 moderate，全部为 devDependencies 传递依赖：

| 漏洞包 | 修复版本 | 引入路径 |
| --- | --- | --- |
| brace-expansion v1 | >=1.1.16 | eslint → @eslint/config-array 等 |
| brace-expansion v3-5 | >=5.0.8 | typescript-eslint 链 |
| js-yaml | >=4.3.0 | eslint → @eslint/eslintrc（现有 override 钉在 4.2.0，本身即漏洞版本） |
| postcss | >=8.5.18 | vitest coverage 链 |
| sharp | >=0.35.0 | model-worker → wrangler 链 |

## 范围变更（2026-07-26 用户批准）

实施中发现第二条 brace-expansion advisory（GHSA，`<=5.0.7` 全脆弱）：v1 链（eslint → minimatch@3）无上游补丁，且 5.0.8 的 CJS 出口为 named exports，与 minimatch@3 的直接函数调用不兼容，override 不可行。唯一真修复 = eslint 9→10（依赖链换到 minimatch@10 → brace-expansion 5.0.8）。已验证：typescript-eslint 8.x peer 支持 ^10、eslint 10 engines 满足、flat config 就位。**用户批准将 eslint 10 + @eslint/js 10 升级并入本任务**（父任务 R6 的 eslint 项由此完成实施，不再只评估）。

## Requirements

1. 通过根 `package.json` 的 `pnpm.overrides` 修复（沿用现有模式）；`js-yaml` 改现有 override 4.2.0 → 4.3.0。
1b. 升级 eslint ^10 + @eslint/js ^10（范围变更批准项），lint 必须全绿。
2. 先 `pnpm why <pkg>` 确认各漏洞包实际主版本分布，按主版本分别钉 override，避免破坏 semver 解析。
3. `sharp` 若 override 引发 wrangler 问题，允许改为升级 wrangler 本体（记录到提交说明，且不与 02 任务重复升级）。
4. 不得放宽 `audit:high` 门禁、不得用 ignore/allowlist 替代修复。
5. moderate 项顺手能修则修，不作硬性要求（记录遗留项）。

## 验收标准

- [x] `corepack pnpm audit --audit-level high` exit 0（实际达成：全量 audit 零漏洞）
- [x] `corepack pnpm check:quick` 全绿（lint/typecheck/test/docs/graphify/architecture/browser-sinks）
- [x] lockfile 与 package.json overrides 一致，`pnpm install --frozen-lockfile` 可复现

## 验证命令

```bash
corepack pnpm install
corepack pnpm audit --audit-level high
corepack pnpm check:quick
```

## 完成记录（2026-07-26）

- 提交：fc0c005（分支 chore/optimization-round2，基底 chore/guardrail-boundary）
- 结果：pnpm audit 全量零漏洞（原 7 high + 2 moderate 全清，protobufjs moderate 顺手修复至 8.7.1）
- 范围变更执行：eslint 10.8.0 + @eslint/js 10.0.1；修复新规则暴露的 4 处代码问题
