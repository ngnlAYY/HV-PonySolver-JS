# Research: Major toolchain upgrades — TypeScript 7, Node 24 LTS, ESLint 10

- **Query**: 评估截至 2026-07-27 的 TypeScript 7.0、Node 24 LTS 与已完成的 ESLint 10 升级；确认项目现状、上游兼容性、收益、风险、建议时机、任务拆分、验证与回滚。
- **Scope**: mixed（主工作区内部配置、临时兼容性探针、官方文档与 npm package metadata）
- **Date**: 2026-07-27

## Executive decision

| 项目           | 当前状态                                                                  | 明确结论                                                                                                                                                                                         | 触发条件 / 下一步                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript 7.0 | 项目为 5.9.3；npm `latest` 已是稳定版 7.0.2                               | **等待，不现在升级主依赖。** 当前代码可被 TS 7.0.2 的 `tsc --noEmit` 检查，但 `typescript-eslint@8.65.0` 明确不支持 TS 7.0，且 TS 7.0 没有稳定 compiler API；标准单包升级会令 `pnpm lint` 失败。 | 至少等 TS 7.1+ 稳定 API，以及 typescript-eslint 发布明确包含所选 TS 7.x 的 peer range、其 TS7 跟踪 issue 关闭；建议先独立完成 5.9→6.0 过渡。                                                             |
| Node 24 LTS    | `engines.node >=22`；所有 CI / deploy 为 Node 22；类型为 `@types/node^22` | **现在可开始 Node 24 兼容 rollout，但不必立即把最低版本抬到 24。** 先测 Node 22 最低受支持 patch + Node 24；通过后可把日常 CI/deploy/dev 默认切到 24，同时保留 Node 22 支持。                    | Node 24 是 Active LTS，且本地主工作区在 Node 24.18.0 上 `pnpm check` 全绿。先在 CI 做 22.13.0 + 24 matrix 并完成 E2E/Wrangler dry-run；是否丢弃 Node 22 可推迟到依赖要求或 Node 22 EOL（2027-04-30）前。 |
| `@types/node`  | npm `latest` 为 26.1.1，但项目运行最低线仍是 Node 22                      | **不得因 npm latest 升到 26。** 类型 major 应表达可用的 Node API 基线：保留 Node 22 runtime 时继续用 `@types/node@22`; 最低 runtime 真正变为 Node 24 时再用 `@types/node@24`。                   | Node 24 类型线当前最新为 24.13.3；版本建议形式为 `^24.0.0`（钉 major 24），而不是 `@types/node@latest`。                                                                                                 |
| ESLint 10      | 已为 ESLint 10.8.0 / `@eslint/js` 10.0.1                                  | **已完成，无新任务。** flat config 与 typescript-eslint 的 ESLint 10 peer 均兼容，安全审计已恢复。                                                                                               | 只记录结果；不要把“支持 ESLint 10”误解为“支持 TypeScript 7”。                                                                                                                                            |

---

## 1. Repository baseline

### Files found

| File path                                                                     | Relevant facts                                                                                                                                                                                                |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json:5-8`                                                            | pnpm 10.0.0；`engines.node` 为 `>=22`。                                                                                                                                                                       |
| `package.json:22-58`                                                          | `lint` 为 `eslint .`；`typecheck` 递归执行；当前 ESLint 10.8.0、`@eslint/js` 10.0.1、TypeScript 5.9.3、typescript-eslint 8.65.0、Vite 8.1.5、Vitest 4.1.10、`@types/node^22.0.0`。                            |
| `apps/userscript/package.json:5-26`                                           | `typecheck` 为 `tsc --noEmit`；Playwright 1.60.0、esbuild 0.27（根 override 实际统一至 0.28.1）、TypeScript 5.9.3、Vitest 4.1.10。                                                                            |
| `apps/model-worker/package.json:5-23`                                         | `build`/`typecheck` 均为 `tsc --noEmit`；Cloudflare pool 0.16.20、workers-types 4.20260702.1、Wrangler 4.114.0。                                                                                              |
| `packages/shared/package.json:8-17`                                           | `build`/`typecheck` 均为 `tsc --noEmit`。                                                                                                                                                                     |
| `tsconfig.base.json:1-12`                                                     | 显式 `target: ES2022`、`module: ESNext`、`moduleResolution: Bundler`、`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`skipLibCheck`、`isolatedModules`、`allowSyntheticDefaultImports`。 |
| `apps/userscript/tsconfig.json:1-6`                                           | 显式 libs 与 `types: []`；只 include `.ts` 源码。                                                                                                                                                             |
| `apps/model-worker/tsconfig.json:1-6`                                         | 显式 `types: ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"]`，并 include Vitest config。                                                                                                    |
| `packages/shared/tsconfig.json:1-6`                                           | 显式 `types: ["vitest/globals"]`。                                                                                                                                                                            |
| `eslint.config.js:1-44`                                                       | 已使用 ESLint flat config 与 `typescript-eslint.config(...)`；没有 typed-lint `project` / `projectService` 配置，但加载 `typescript-eslint` 顶层包仍会触发其 TS7 hard error。                                 |
| `apps/model-worker/vitest.config.ts:1-40`                                     | 配置文件本身在 TypeScript include 内；加载 Cloudflare test plugin 和 Wrangler 配置。                                                                                                                          |
| `.github/workflows/verify-monorepo.yml:53-57,101-105,131-135,168-172,217-221` | guardrails、test、coverage-build、E2E、bundled userscript 全固定 Node 22。                                                                                                                                    |
| `.github/workflows/deploy-cloudflare-model-worker.yml:38-42`                  | deploy 固定 Node 22。                                                                                                                                                                                         |
| `apps/model-worker/wrangler.template.toml:1-3`                                | Worker compatibility date 为 2026-05-18；没有 `nodejs_compat` flag。                                                                                                                                          |
| `.trellis/tasks/07-26-project-optimization-round2/prd.md:44-46,77-83`         | R6 原本只评估 major；随后 ESLint 10 获批准并入安全子任务。                                                                                                                                                    |
| `.trellis/tasks/07-26-project-optimization-round2/implement.md:16-17,28-34`   | 安全子任务已通过，commit `fc0c005`，全量 audit 零漏洞；R6 报告已完成，父任务仍等待 R5 远程验收与最终 wrap-up。                                                                                                |

### Important configuration interpretation

1. 项目把 TypeScript 用作独立静态检查器：三个 workspace 的命令均为 `tsc --noEmit`。
2. Userscript 的运行产物由 esbuild 构建；Vite/Vitest 负责测试转换；Cloudflare Worker 由 Wrangler/esbuild 打包。它们不是通过项目安装的 `typescript` 包做普通 `.ts` 转换。
3. 项目没有直接导入 `typescript` compiler API，也没有自定义 TypeScript language-service plugin。当前直接 API 阻塞来自 typescript-eslint 生态，不是业务源码。
4. Worker 的生产 runtime 是 workerd。GitHub Actions 与 Wrangler CLI 使用的 Node major，不会改变已部署 Worker 的 runtime、compatibility date 或 API surface。

---

## 2. TypeScript 7.0 assessment

### 2.1 Confirmed release state

**Confirmed facts**

- npm registry 在查询日返回：
  - `typescript` `latest = 7.0.2`
  - `next = 7.1.0-dev.20260726.1`
  - `rc = 7.0.1-rc`
  - 7.0.2 发布于 2026-07-08。
- `7.0.2` 是正常稳定 semver，不带 prerelease 标识，也没有 deprecation；因此 TypeScript 7.0 **已经正式发布，不是预览版**。
- `typescript@7.0.2` 的 Node engine 为 `>=16.20.0`。
- TypeScript 7.0 是 Go native port 的正式 `typescript` 包；稳定版本继续提供 `tsc` binary。早期 `@typescript/native-preview` / `tsgo` 名称是预览阶段安排，官方 README 明确说 7.0 RC 以后命令名为 `tsc`。
- 稳定包使用平台原生 optional dependencies（例如 `@typescript/typescript-linux-x64@7.0.2`）。这带来明显速度收益，也意味着安装/缓存需包含匹配平台的 native 包。

**What npm latest does and does not prove**

- `latest=7.0.2` 只证明 TypeScript 自身的默认发布版本。
- 它**不证明** typescript-eslint、Vitest、Vite、esbuild 或 Cloudflare 工具已经兼容；这些必须分别看 peer metadata、官方声明及实测。

### 2.2 TS 7 / tsgo behavior and breaking changes

Official TypeScript 7 notes state:

- 原生实现常见 full build 提速约 8x–12x；解析、检查和 emit 可并行。
- 新增 `--checkers`、`--builders` 和 `--singleThreaded`；默认 4 个 checker。更多并行可能增加 CI 内存占用；不同 checker 数在极少数顺序依赖场景可能暴露不同结果。
- TS 7.0 目标是与 TS 6.0 的命令行和检查行为兼容，但它采用 TS 6.0 新默认值，并把 TS 6.0 已弃用的 flags/constructs 变成 hard errors。
- TS 7.0 **不提供稳定 compiler API**。官方预计 7.1 提供“new (and different) API”。
- 官方为需要旧 API 的工具提供 `@typescript/typescript6`，可用 TS6 API 与 TS7 `tsc` 双栈运行。

Crossing 5.9 → 7.0 therefore also crosses TS 6 changes:

- 新默认：`strict: true`、`module: esnext`、较新的 default target、`noUncheckedSideEffectImports: true`、`libReplacement: false`、强制 stable type ordering、`rootDir: ./`、`types: []`。
- 变成 hard error / removed 的重要项：`target: es5`、`downlevelIteration`、`moduleResolution: node/node10/classic`、`module: amd/umd/systemjs/none`、`baseUrl`、把 `esModuleInterop`/`allowSyntheticDefaultImports`/`alwaysStrict` 设为 false、旧 `assert` import attributes、特定 `module` namespace 写法等。
- 有意行为变化包括 template literal type 按 Unicode code point 推断，以及 JavaScript/JSDoc/Closure 风格支持收紧。
- `--skipLibCheck` 下 declaration conflict 的报告更一致；某些冲突仍可能在非 `.d.ts` 位置出现。
- 当前 package 没有传统 `lib/typescript.js` API；其 `exports["."]` 仅提供版本信息，新的 API 位于 `unstable/*` 路径。这正是旧 API 消费者不能直接工作的原因。

### 2.3 Project-specific migration risk

#### Confirmed low-risk areas

- 当前共享 tsconfig 已显式设置 `strict`、`target`、`module`、`moduleResolution: Bundler`；没有使用上述已移除的 node10/classic/baseUrl/AMD/ES5 配置。
- 三个叶 tsconfig 都显式设置 `types`，所以 TS6/7 的 `types: []` 默认不会悄然移除项目现有 globals。
- `isolatedModules: true` 与 esbuild/Vite 单文件转换模型一致。
- 只 include `.ts`（没有 `allowJs`），因此 TS7 大量 JavaScript/JSDoc 行为变化对当前 typecheck 范围影响小。
- 临时安装 `typescript@7.0.2` 后，以下三个命令均 exit 0，且没有修改主工作区：
  - `tsc -p apps/userscript/tsconfig.json --noEmit`
  - `tsc -p apps/model-worker/tsconfig.json --noEmit`
  - `tsc -p packages/shared/tsconfig.json --noEmit`
- 这次探针也实际消费了 Vitest、Cloudflare pool/workers types 与各 `vitest.config.ts` 声明，说明**当前项目代码与当前声明集合**可通过 TS7 CLI。

#### Confirmed blocker: typescript-eslint 8.65.0

- `typescript-eslint@8.65.0`、`@typescript-eslint/parser@8.65.0` 和 `@typescript-eslint/typescript-estree@8.65.0` 均声明 TypeScript peer `>=4.8.4 <6.1.0`。
- 官方 dependency-version 页面同样只列 `>=4.8.4 <6.1.0`。
- 官方 TS7 跟踪 issue `#10940` 仍 open；它明确涉及 TS7 native API/AST/type-information 集成。
- 对当前 ESLint 10 + typescript-eslint 8.65.0 + TS7.0.2 做隔离探针时，lint 在加载配置时 hard fail：

```text
typescript-eslint does not support TS 7.0.
Please see https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0 to run typescript-eslint using the TS 6 API.
See also https://github.com/typescript-eslint/typescript-eslint/issues/10940 for tracking typescript-eslint's support for TS >=7.1
```

- 因此“项目没启用 typed lint”不能绕开问题：`eslint.config.js` 顶层导入 `typescript-eslint`，包初始化即拒绝 TS7。
- 强行 override/忽略 peer dependency 不是兼容方案；当前版本主动报错。

#### Inference: performance benefit is real but project payoff is smaller than upstream headline

- 非正式单次本地探针（三个项目分别启动一个进程）观察到总 elapsed 大约从 TS5.9 的 3.54s 降至 TS7 的 0.55s，约 6.5x。
- 这不是受控 benchmark；机器 cache、并行和 native startup 都影响结果，只能证明该小仓库也能看到方向一致的收益，不能作为 8x–12x SLA。
- 由于当前仓库 typecheck 已是秒级，收益不足以抵消双 TypeScript 栈、peer override 或 lint 失效的维护成本。

### 2.4 Vitest / Vite / esbuild / Cloudflare support status

| Tool                                      | Confirmed metadata / behavior                                                                                              | TS7 conclusion                                                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vitest 4.1.10                             | 没有 TypeScript peer；peer Vite 为 `^6                                                                                     |                                                                                                                                                                     | ^7  |     | ^8`。普通测试转换不依赖项目 `typescript`包。只有启用 Vitest typecheck 功能时才 spawn`tsc`；本项目没有用该功能。 | 没有发现“官方 TS7 certification”声明；但当前测试声明已被 TS7 probe 成功检查。不是当前 blocker。 |
| Vite 8.1.5                                | 没有 TypeScript peer。官方文档说明 Vite 只 transpile、不 typecheck，建议另跑 `tsc --noEmit`；Vite 8 文档说明转换使用 Oxc。 | Vite runtime transformation 与项目 TypeScript npm major 解耦。当前代码/config 可过 TS7；未来新 TS syntax 是否被对应 Oxc/Vite 版本解析，仍需在实际 build/test 验证。 |
| esbuild 0.28.1                            | 没有 TypeScript peer；内建解析 TS 并丢弃 types，不做 typecheck；官方建议并行运行 `tsc --noEmit`。                          | 不能从 npm latest 推导 TS7 支持；对当前 TS syntax 没有已知阻塞。Userscript build 仍须在实际 TS7 branch 执行。                                                       |
| Wrangler 4.114.0                          | Node engine `>=22`；无 TypeScript peer；依赖 esbuild 0.28.1/workerd。                                                      | Wrangler 打包不依赖 TypeScript compiler API；当前 Worker TS declarations 通过 TS7 CLI，但正式升级仍须跑 dry-run。                                                   |
| `@cloudflare/vitest-pool-workers` 0.16.20 | 自身没有 Node engine 或 TypeScript peer；Vitest peers 为 `^4.1.0`；依赖 Wrangler 4.105.0、Miniflare、esbuild 0.28.1。      | 无明确官方 TS7 support 声明；当前 pool config/type declarations 已通过 TS7 CLI。不是已确认 blocker，但不能把“无 peer”写成官方保证。                                 |
| `@cloudflare/workers-types`               | 是 workerd API 类型，不是 Node runtime 类型。                                                                              | 当前声明在项目的 `skipLibCheck` 配置下通过 TS7；Worker runtime 是否匹配由 compatibility date/flags 决定，与 TS compiler major 分开。                                |

**Cloudflare metadata caveat unrelated to TS7**: `wrangler@4.114.0` npm metadata 的 optional peer 为 `@cloudflare/workers-types ^5.20260722.1`，而项目当前声明 `^4.20260702.1`。这不是 TS7/Node24 兼容证据，应在 Cloudflare 依赖批次中单独核对，不能靠 TS7 probe 消除。

### 2.5 Recommendation and trigger conditions

**Recommendation: WAIT for the main TS7 upgrade.**

Do not replace current `typescript@5.9.3` with `typescript@7.0.2` now. The decisive reason is not TS7 prerelease quality—it is stable—but the absence of TS7.0 API plus an explicit, reproducible typescript-eslint refusal.

Proceed only when all of the following are true:

1. TypeScript 7.1 or later is stable and exposes the promised supported API (not only `unstable/*`).
2. A released typescript-eslint version has a peer range that explicitly includes the selected TypeScript 7.x line.
3. typescript-eslint issue `#10940` or its replacement release tracker documents support; no `--force`, peer override or unsupported-version bypass is needed.
4. Clean `pnpm install --frozen-lockfile` succeeds on supported dev/CI platforms and fetches the proper native TypeScript package.
5. `pnpm lint`, all three `tsc --noEmit` checks, tests, coverage, builds, userscript E2E, and Wrangler dry-run are green.
6. TS7 `--showConfig` output is compared against the current compiler, and any changed default is consciously accepted.
7. CI memory/parallel behavior is measured; if needed, fix `--checkers` rather than relying on machine-dependent defaults。

### 2.6 Independent task split

1. **TS 6 preparation task (eligible now, separate from TS7)**
   - Move 5.9.3 → latest 6.0.x while typescript-eslint 8.65 supports `<6.1.0`.
   - Absorb TS6 defaults/deprecations first, as the TS7 team explicitly recommends.
   - Keep `tsc --noEmit` scripts unchanged.
2. **TS7 non-blocking evaluation task (optional only)**
   - Use a temporary/CI experiment or official TS6/TS7 side-by-side alias scheme.
   - Do not make it the canonical lockfile/toolchain until lint compatibility exists.
3. **TS7.1+ production upgrade task (after triggers)**
   - Upgrade compiler + typescript-eslint together.
   - Validate editor/LSP behavior separately from CLI, especially because the API and language server foundation changed.
   - Benchmark typecheck and CI memory before/after.

The official side-by-side workaround (`@typescript/typescript6` for tooling plus an alias for TS7 `tsc`) is technically available. For this repository it is a temporary experiment, not the recommended steady state: dependency declarations are repeated at root and in three workspaces, scripts currently assume a single `tsc`, and the measured check is already short.

### 2.7 Verification commands for a future TS task

```bash
npm view typescript version dist-tags engines
npm view typescript-eslint peerDependencies engines
npm view @typescript-eslint/parser peerDependencies
corepack pnpm why typescript
corepack pnpm install --frozen-lockfile
corepack pnpm exec tsc --version
corepack pnpm exec tsc --showConfig -p apps/userscript/tsconfig.json
corepack pnpm exec tsc --showConfig -p apps/model-worker/tsconfig.json
corepack pnpm exec tsc --showConfig -p packages/shared/tsconfig.json
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:coverage
corepack pnpm build
corepack pnpm test:e2e:userscript
```

For Worker deploy validation, render a valid deploy config and run the existing guarded dry-run path:

```bash
corepack pnpm --filter @hv-pony-solver/model-worker typecheck
corepack pnpm --filter @hv-pony-solver/model-worker test
corepack pnpm --filter @hv-pony-solver/model-worker exec wrangler deploy --dry-run
```

### 2.8 Rollback

- Restore every root/workspace `typescript` dependency and lockfile entry to the last known-good 5.9/6.0 state.
- Remove any TS6 compatibility aliases and TS7 native aliases as one atomic rollback; do not leave two accidental compiler bins.
- Reinstall with frozen lockfile and verify `tsc --version`, `pnpm lint`, `pnpm typecheck`, then `pnpm check`.
- Keep source/tsconfig migration changes in a separate commit so compiler-package rollback is reviewable and can be reverted independently.

---

## 3. Node 24 LTS assessment

### 3.1 Lifecycle and current release

**Confirmed facts from Node Release Working Group**

| Line              | Status on 2026-07-27 | Maintenance starts | End of support |
| ----------------- | -------------------- | -----------------: | -------------: |
| Node 22 “Jod”     | Maintenance LTS      |         2025-10-21 |     2027-04-30 |
| Node 24 “Krypton” | **Active LTS**       |         2026-10-20 | **2028-04-30** |
| Node 26           | Current              |         2027-10-20 |     2029-04-30 |

- Node 24 entered LTS on 2025-10-28 with 24.11.0.
- Current official dist index query returned Node 24.18.0 (2026-06-23) and Node 22.23.1 (2026-06-22).
- Node 24 notable platform changes include V8 13.6, npm 11, AsyncLocalStorage implementation changes, global URLPattern, node:test improvements, Undici 7, and several runtime deprecations/removals.
- This repository pins pnpm via `packageManager`, so npm 11 bundled in Node 24 is not itself a package-manager migration benefit.

### 3.2 Package support / engine matrix

| Package                                   | Declared Node engine / official support                                                                                           | Node 24 assessment                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Wrangler 4.114.0                          | npm engine `>=22.0.0`; Cloudflare docs support Node Current, Active, and Maintenance lines.                                       | Explicitly compatible. Node 24 Active LTS is within official CLI policy.                                                   |
| `@cloudflare/vitest-pool-workers` 0.16.20 | **No top-level `engines` field**. It peers Vitest `^4.1.0` and depends on Wrangler 4.105.0/Miniflare, both requiring Node `>=22`. | Supported by effective dependency floor and local execution, but there is no standalone top-level engine promise to quote. |
| Vitest 4.1.10                             | `^20.0.0                                                                                                                          |                                                                                                                            | ^22.0.0     |                                  | >=24.0.0`. | Node 24 explicit.                                                                                              |
| Vite 8.1.5                                | `^20.19.0                                                                                                                         |                                                                                                                            | >=22.12.0`. | Node 24 included by `>=22.12.0`. |
| esbuild 0.28.1                            | `>=18`.                                                                                                                           | Node 24 included.                                                                                                          |
| Playwright Test 1.60.0                    | npm engine `>=18`; v1.60 docs list latest Node 20.x, 22.x, or 24.x.                                                               | Node 24 explicit in versioned docs.                                                                                        |
| ESLint 10.8.0 / `@eslint/js` 10.0.1       | `^20.19.0                                                                                                                         |                                                                                                                            | ^22.13.0    |                                  | >=24`.     | Node 24 explicit. Also establishes that project-level `>=22` currently overstates support for Node 22.0–22.12. |
| typescript-eslint 8.65.0                  | `^18.18.0                                                                                                                         |                                                                                                                            | ^20.9.0     |                                  | >=21.1.0`. | Node 24 included.                                                                                              |
| TypeScript 5.9.3 / 7.0.2                  | Both run on Node 24; TS7 engine is `>=16.20.0`.                                                                                   | Not a Node24 blocker.                                                                                                      |

### 3.3 Local Node 24 evidence

Main workspace environment was Node 24.18.0 with pnpm 10.0.0. The following completed exit 0:

```bash
corepack pnpm --dir /home/ngnl/Projects/HV-PonySolver-JS check
```

This covered:

- ESLint 10 lint
- all `tsc --noEmit` checks
- Vitest tests, including Cloudflare pool Worker tests
- Node built-in test-runner suites
- coverage
- userscript esbuild build and bundle budget
- model-worker/shared builds

**Not covered by this local `check`**

- Playwright userscript E2E (separate command)
- Wrangler deploy `--dry-run` and actual deploy
- GitHub Actions runner-specific behavior/caching
- Node 22 minimum-patch compatibility
- production workerd behavior (which is not Node 24 behavior)

Therefore the local result is strong compatibility evidence, but it is not sufficient to remove the Node22 CI lane immediately.

### 3.4 `engines`, CI, and development environment

#### Confirmed issue in the current range

The direct dependencies impose an effective Node 22 minimum of **22.13.0**:

- Vite requires >=22.12.0 on the Node 22 line.
- ESLint 10 / `@eslint/js` require >=22.13.0 on that line.

Thus root `"node": ">=22"` permits versions that the current direct toolchain does not support. This is independent of whether the project adopts Node 24 as default.

#### Recommended rollout

1. **Additive qualification first**
   - CI matrix: Node `22.13.0` (declared minimum lane) and Node `24` (Active LTS lane).
   - Run install, lint, typecheck, tests, coverage/build, E2E, and model-worker dry-run where credentials/config allow.
   - Using exact 22.13.0 tests the stated floor; using only setup-node `22` tests the latest patch, not the floor.
2. **After at least two green PR runs**
   - Make Node 24 the canonical day-to-day CI/deploy/dev version.
   - Retain the 22.13 compatibility lane while `engines` promises Node 22.
3. **Engine policy**
   - Do **not** jump directly to `>=24` merely because Node 24 is LTS.
   - Keep support at the Node 22 major for now, but represent the actual floor as `>=22.13.0` if the package engine is intended to be accurate.
   - Reassess dropping 22 when a dependency requires 24, maintenance burden appears, or before Node 22 EOL on 2027-04-30.
4. **Developer pin**
   - A dev version-manager file can point to Node 24 while `engines` remains `>=22.13.0`; “recommended development version” and “minimum supported version” do not need to be identical.
5. **Deploy workflow**
   - Switch the Wrangler host process to Node 24 only after matrix qualification. This changes the deployment tool host, not the Worker runtime.

A full 22×24 expansion of every existing job may double CI cost. An equivalent first stage can use existing Node22 jobs plus one Node24 `node-compat` job running `pnpm check` and E2E/dry-run, provided branch protection treats it as required. The contract to preserve is that both supported majors execute meaningful checks, not merely `node --version`.

### 3.5 `@types/node`: which major to pin

**Confirmed facts**

- npm `@types/node latest` is 26.1.1 because Node 26 is the current release line.
- The latest published Node 24 type line at query time is 24.13.3.
- Vitest's broad peer accepts Node type majors 20, 22, or >=24; that range does not choose the correct project API baseline.

**Recommendation**

- While runtime support includes Node 22, keep `@types/node` on major 22. This helps prevent source/config code from silently using Node24-only APIs while claiming Node22 compatibility.
- If and only if the engine minimum becomes Node24, move to `@types/node@^24.0.0` (or the selected current 24.x), not 26.
- If testing Node22 + Node24 together, use the minimum-runtime type line (22) as the canonical static contract; runtime matrix testing covers behavioral compatibility on both majors.
- `@types/node@26` would be appropriate only when the intended compile-time API target is Node26. Its npm `latest` tag is neither Node24 support evidence nor a reason to use Node26 declarations.

### 3.6 Node CLI vs Cloudflare Worker runtime

This distinction is mandatory:

- Node runs pnpm, ESLint, TypeScript, Vitest orchestration, Playwright, Wrangler CLI, repository `.mjs` scripts, and CI workflows.
- Deployed Worker code executes in **workerd**, as Cloudflare's Wrangler install documentation explicitly states.
- `compatibility_date = "2026-05-18"` controls Worker runtime compatibility. Changing setup-node from 22 to 24 does not change that date.
- The Worker has no `nodejs_compat` flag. Even when enabled, Cloudflare provides a subset/polyfills of Node APIs; it is not the same as deploying to a Node24 process.
- `@cloudflare/workers-types` describes workerd APIs; `@types/node` describes Node APIs. They should not be upgraded in lockstep unless the Worker actually enables/uses Node compatibility.

### 3.7 Benefits and risks

**Benefits**

- Active LTS instead of Maintenance LTS for the default tool host.
- Support to 2028-04-30, one year beyond Node22.
- Newer V8/Undici/node:test behavior and ongoing active fixes.
- All named direct tools declare or effectively support Node24; local full checks already pass.

**Risks**

- Node major runtime/deprecation differences can affect repository `.mjs`, node:test, fetch/Undici, child processes, or native/optional packages.
- esbuild, workerd, sharp and TypeScript 7 use platform-specific/native artifacts; clean CI install is stronger evidence than a reused local store.
- Playwright browser installation/cache and Wrangler dry-run were not covered by local `pnpm check`.
- If Node22 remains promised but CI only runs Node24, later code may accidentally consume Node24-only APIs.
- Raising `@types/node` early would mask this exact problem.

### 3.8 Independent Node task split

1. **Node24 CI qualification**
   - Matrix minimum Node22 patch + Node24.
   - Keep package engines/types unchanged except optionally correcting the real Node22 floor.
   - Record check/E2E/dry-run duration and failures.
2. **Default tooling switch**
   - After soak, change normal CI/deploy/dev default to Node24.
   - Retain required Node22 compatibility lane.
3. **Node22 retirement (future, not now)**
   - Change engine to >=24 and `@types/node` to major 24 together.
   - Remove Node22 CI only in this task, with an explicit support-policy decision.

### 3.9 Verification commands

Run under both Node 22.13.0 and a current Node 24.x in clean environments:

```bash
node --version
corepack pnpm --version
corepack pnpm install --frozen-lockfile
corepack pnpm exec eslint --version
corepack pnpm exec tsc --version
corepack pnpm exec vitest --version
corepack pnpm --filter @hv-pony-solver/model-worker exec wrangler --version
corepack pnpm --filter @hv-pony-solver/userscript exec playwright --version
corepack pnpm check
corepack pnpm test:e2e:userscript
```

Then run the existing deploy validation path with valid rendered configuration:

```bash
corepack pnpm --filter @hv-pony-solver/model-worker render-config
corepack pnpm --filter @hv-pony-solver/model-worker typecheck
corepack pnpm --filter @hv-pony-solver/model-worker test
corepack pnpm --filter @hv-pony-solver/model-worker exec node scripts/validate-wrangler-config.mjs
corepack pnpm --filter @hv-pony-solver/model-worker exec wrangler deploy --dry-run
```

Also inspect metadata rather than relying on latest tags:

```bash
npm view wrangler@4.114.0 engines
npm view @cloudflare/vitest-pool-workers@0.16.20 engines peerDependencies dependencies
npm view vitest@4.1.10 engines peerDependencies
npm view @playwright/test@1.60.0 engines
npm view @types/node@24 version
npm view @types/node dist-tags
```

### 3.10 Rollback

- Because qualification is additive, first rollback is simply removing/disabling the Node24 CI lane while Node22 remains canonical.
- If default CI/deploy was switched, restore setup-node to 22 and retain the compatibility evidence in task notes.
- If engines or `@types/node` changed, restore `package.json` and lockfile atomically, reinstall frozen, then run `pnpm check` on Node22.
- A Node host rollback does not require changing Worker compatibility date or redeploying Worker code unless a deployment artifact itself changed.

---

## 4. ESLint 10 — completed result only

### Confirmed repository result

- Current root versions: `eslint ^10.8.0`, `@eslint/js ^10.0.1`, `typescript-eslint ^8.65.0`.
- Flat config was already in use and remains in `eslint.config.js`.
- `typescript-eslint@8.65.0` peer range explicitly supports ESLint `^10.0.0`.
- ESLint 10 / `@eslint/js` Node engines are `^20.19.0 || ^22.13.0 || >=24`.
- Parent task records security subtask completion at commit `fc0c005`, `pnpm audit` zero vulnerabilities, and successful checks.
- Current main workspace `pnpm check` also passes on Node24.18.0.

### Conclusion

No new ESLint-major task is recommended. The upgrade is complete and validated. Its important continuing compatibility fact is:

> typescript-eslint 8.65 supports ESLint 10, but only TypeScript `<6.1.0`; ESLint-major compatibility does not remove the TypeScript 7 blocker.

Rolling ESLint 10 back would also undo the approved security-audit solution and is not part of either proposed TypeScript or Node task.

---

## 5. External references and package metadata

All sources below were queried on **2026-07-27** unless the page itself has a stated update date.

### TypeScript / typescript-eslint

- [npm registry: TypeScript 7.0.2](https://registry.npmjs.org/typescript/7.0.2) — exact stable version, engines, native platform packages, exports, bin.
- [npm registry: TypeScript package metadata](https://registry.npmjs.org/typescript) — dist-tags and publication timestamps; used only as release-state evidence.
- [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) — official release, performance, side-by-side TS6 arrangement, breaking/default changes, API status and roadmap.
- [TypeScript Go README](https://github.com/microsoft/typescript-go/blob/main/README.md) — preview `tsgo` history and RC+ `tsc` naming.
- [TypeScript Go CHANGES](https://github.com/microsoft/typescript-go/blob/main/CHANGES.md) — intentional TS6-vs-TS7 behavior differences.
- [TypeScript 7.0.2 GitHub release](https://github.com/microsoft/typescript-go/releases/tag/typescript/v7.0.2) — official release record, published 2026-07-08.
- [typescript-eslint dependency versions](https://typescript-eslint.io/users/dependency-versions/) — official supported TypeScript `<6.1.0`, ESLint 10 range, Node policy.
- [typescript-eslint TS7 tracking issue #10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940) — open API/parser integration tracker.
- [typescript-eslint TS7 support report #12518](https://github.com/typescript-eslint/typescript-eslint/issues/12518) — install/lint failure report; closed not planned because 7.0 lacks usable API path.
- [npm registry: typescript-eslint 8.65.0](https://registry.npmjs.org/typescript-eslint/8.65.0) — exact peers and engines.
- [npm registry: TS6 compatibility package](https://registry.npmjs.org/%40typescript%2ftypescript6) — `@typescript/typescript6@6.0.2`, TS6 API and `tsc6` bin.

### Vitest / Vite / esbuild / Cloudflare

- [npm registry: Vitest 4.1.10](https://registry.npmjs.org/vitest/4.1.10) — Node and Vite peers; no TypeScript peer.
- [Vitest guide](https://vitest.dev/guide/) — documented Node baseline.
- [npm registry: Vite 8.1.5](https://registry.npmjs.org/vite/8.1.5) — Node engines and peers; no TypeScript peer.
- [Vite TypeScript features](https://vite.dev/guide/features.html#typescript) — transpile-only model, Oxc, separate `tsc --noEmit`, isolatedModules guidance.
- [npm registry: esbuild 0.28.1](https://registry.npmjs.org/esbuild/0.28.1) — Node engine and lack of TypeScript peer.
- [esbuild TypeScript docs](https://esbuild.github.io/content-types/#typescript) — built-in TS parser, no typechecking, independent-file caveats.
- [npm registry: Wrangler 4.114.0](https://registry.npmjs.org/wrangler/4.114.0) — exact Node engine/dependency/peer metadata.
- [Wrangler install/system requirements](https://developers.cloudflare.com/workers/wrangler/install-and-update/) — support for Current/Active/Maintenance Node lines and workerd runtime distinction.
- [Wrangler 4.114.0 package manifest](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.114.0/packages/wrangler/package.json) — versioned official package source.
- [npm registry: Cloudflare Vitest pool 0.16.20](https://registry.npmjs.org/%40cloudflare%2fvitest-pool-workers/0.16.20) — no engine field; exact peers/dependencies.
- [Cloudflare Vitest pool 0.16.20 manifest](https://github.com/cloudflare/workers-sdk/blob/%40cloudflare%2Fvitest-pool-workers%400.16.20/packages/vitest-pool-workers/package.json) — versioned official package source.
- [Cloudflare Worker Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) — workerd Node API subset/polyfills; page last updated 2026-07-01.
- [Cloudflare TypeScript docs](https://developers.cloudflare.com/workers/languages/typescript/) — Worker types depend on compatibility date/flags, not host Node; page last updated 2026-07-03.

### Node / Playwright / ESLint / types

- [Node release schedule README](https://github.com/nodejs/Release/blob/main/README.md) — current lifecycle table and phase definitions.
- [Node schedule JSON](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json) — machine-readable Node22/24/26 dates.
- [Node 24.11.0 “Krypton” LTS release](https://nodejs.org/en/blog/release/v24.11.0) — official LTS transition and support through April 2028.
- [Node 24.0.0 release](https://nodejs.org/en/blog/release/v24.0.0) — V8/npm/runtime changes and removals.
- [Node dist index](https://nodejs.org/dist/index.json) — current Node24/22 patch evidence.
- [npm registry: Playwright Test 1.60.0](https://registry.npmjs.org/%40playwright%2ftest/1.60.0) — package engine.
- [Playwright 1.60 system requirements](https://github.com/microsoft/playwright/blob/v1.60.0/docs/src/intro-js.md#system-requirements) — versioned Node 20/22/24 support.
- [npm registry: ESLint 10.8.0](https://registry.npmjs.org/eslint/10.8.0) — Node engine.
- [npm registry: `@eslint/js` 10.0.1](https://registry.npmjs.org/%40eslint%2fjs/10.0.1) — Node and ESLint peers.
- [npm registry: `@types/node`](https://registry.npmjs.org/%40types%2fnode) — exact dist-tags/version lines; npm latest is not runtime-target guidance.
- [npm registry: `@types/node` 24.13.3](https://registry.npmjs.org/%40types%2fnode/24.13.3) — selected Node24 major metadata.

---

## 6. Confirmed facts vs inference vs unknowns

### Confirmed

- TS7.0.2 is stable npm latest, not prerelease.
- All three current project tsconfigs pass TS7.0.2 CLI in a temporary probe.
- typescript-eslint 8.65.0 explicitly rejects TS7.0 and has peer `<6.1.0`; current lint cannot use a normal one-package TS7 upgrade.
- Node24 is Active LTS until maintenance on 2026-10-20 and supported through 2028-04-30.
- Named runtime tools' metadata admits Node24; Cloudflare pool lacks its own engine but its decisive dependencies require >=22.
- Main workspace `pnpm check` passes locally on Node24.18.0.
- Worker executes in workerd, not the CI/developer Node process.
- `@types/node` latest is 26.1.1; a Node24 target has a separate major-24 line.
- ESLint 10 is already implemented and green.

### Inference / recommendation

- Waiting for TS7.1+ plus typescript-eslint support has lower total cost than adopting the official TS6/TS7 dual stack in this small monorepo.
- Node24 is ready for additive CI qualification now; retaining Node22 as minimum avoids an unnecessary support break.
- `@types/node` should model the minimum supported runtime, not the newest npm tag.
- Correcting the Node22 minimum patch to 22.13.0 is more accurate than the current broad `>=22` while still preserving Node22 support.

### Unknown / not yet verified

- No official per-version statement was found saying “Vitest 4.1.10 / Vite 8.1.5 / esbuild 0.28.1 / Cloudflare pool 0.16.20 supports TypeScript 7”. Their architecture and project probe show no present blocker, but absence of a TypeScript peer is not certification.
- Future TS7-only syntax compatibility in Oxc/esbuild is not established by compiling current code.
- TS7.1 API release date/final shape and the first typescript-eslint release that supports it are unknown.
- Node24 Playwright E2E, clean GitHub Actions install, Wrangler authenticated dry-run/deploy, and cold native-package caches remain to be verified remotely.
- Whether all contributor platforms are among TS7's published native targets was not inventoried; clean install must be part of any TS7 task.
