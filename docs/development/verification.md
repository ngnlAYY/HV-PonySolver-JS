# 开发与验证手册

本文集中说明本仓库的本地工具链、测试分层、CI 门禁、浏览器证据和生成物边界。源码、测试或工作流变化时，应同步检查本文是否仍然准确。

## 1. 工具链与工作区

仓库是 pnpm workspace，由根目录 [`mise.toml`](../../mise.toml) 固定 Node.js 24.15.0、pnpm 12.3.0。根 [`package.json`](../../package.json) 的 `engines.node` 是最低兼容要求 `>=24.15.0`，`packageManager` 固定为 `pnpm@12.3.0`。`mise.toml` 是本地和 GitHub Actions 的工具版本来源，不要重新引入 `.node-version`、Corepack 或 `setup-node` 作为第二套来源。

[`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) 的 `pmOnFail: ignore` 是有意的兼容边界：pnpm 12 只维护不含 YAML document separator 的 project lock，而不在 [`pnpm-lock.yaml`](../../pnpm-lock.yaml) 前写 package-manager environment document。同时启用 `blockExoticSubdeps: true`、`trustPolicy: no-downgrade`，对超过 10080 分钟（7 天）的既有版本使用 `trustPolicyIgnoreAfter: 10080`，并将新依赖的最短发布等待时间设为 10080 分钟；Cloudflare Workers 类型包通过 `minimumReleaseAgeExclude` 明确列为例外。GitHub Dependency Graph 和 Pull Request Dependency Review 因此能读取 workspace 的真实依赖变化。代价是不能把 pnpm 自身的 package-manager mismatch failure 当成版本证明；本仓库改由 mise pin、`packageManager` 声明、`pnpm install --frozen-lockfile` 和 `node-version-contract.test.mjs` fail closed 保证一致性。

首次准备环境：

```bash
mise trust
mise install
mise exec -- pnpm install --frozen-lockfile
```

日常命令优先写成 `mise exec -- pnpm ...`。工作区职责和直接入口如下：

| 工作区                  | 主要职责                                    | 直接验证                                                 |
| ----------------------- | ------------------------------------------- | -------------------------------------------------------- |
| `packages/shared`       | 模型、令牌、答案和 ORT 资产契约             | `typecheck`、`test`                                      |
| `packages/browser-core` | DOM、答题、推理、缓存和状态面板共用逻辑     | `typecheck`、`test`                                      |
| `apps/userscript`       | 用户脚本、GM 适配器、Worker 和构建          | `typecheck`、`test`、`test:e2e`                          |
| `apps/extension`        | MV3 入口、后台代理、推理 Host、设置页和打包 | `typecheck`、`test`、浏览器 E2E                          |
| `apps/model-worker`     | Cloudflare Worker、Key 鉴权、R2 资产和额度  | `typecheck`、`test`；线上探测另行执行 `check:deployment` |

依赖方向由 [`scripts/checks/check-architecture-boundaries.mjs`](../../scripts/checks/check-architecture-boundaries.mjs) 维护。启用类型依赖检查的边界同时覆盖 `import type`、`import('…').Type` 与 `typeof import('…')`，不能用类型查询绕开依赖约束。新增跨包导入、移动目录或修改 package export 后必须运行 `architecture:check`。

## 2. 按修改区域选择验证

先运行能直接证明修改正确的最小命令，再按边界扩大：

| 修改区域                                      | 最小验证                                           | 补充验证                                                                                          |
| --------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `packages/shared` 契约或资产                  | shared `typecheck`、`test`                         | `docs:check`；受影响应用检查                                                                      |
| `packages/browser-core` DOM、答题、面板或推理 | browser-core `typecheck`、`test`                   | `architecture:check`、`browser-sinks:check`、页面 E2E                                             |
| `apps/userscript` 构建或运行时                | userscript `typecheck`、`test`、`build`            | default/bundled 两个 bundle profile；页面 E2E                                                     |
| `apps/extension` 消息、权限、缓存或打包       | extension `typecheck`、`test`、`build`             | content、Chromium、Firefox、packaged、最低版本边界                                                |
| `apps/model-worker` 路由、额度或配置          | 渲染测试配置、worker `typecheck`、`test`           | `docs:check`；需要线上绑定时再执行 `check:deployment`，并记录环境与目标                           |
| `scripts`、根配置或工作流                     | 对应 `scripts/**/*.test.mjs` 或 `pnpm test`        | `format:check`、`lint`、`docs:check`、`architecture:check`、`browser-sinks:check`、pinned-actions |
| `README.md` 或 `docs/`                        | `node --test "scripts/docs-drift/test/*.test.mjs"` | `pnpm format:check`、`pnpm docs:check`、`git diff --check`                                        |

修改公开命令、默认值、路由、资产或构建方式时，[`README.md`](../../README.md)、主题文档、测试和 [`scripts/docs-drift/`](../../scripts/docs-drift/) 必须一起检查。

## 3. 根命令与测试分层

根 [`package.json`](../../package.json) 的主要命令：

| 命令                       | 作用                                               |
| -------------------------- | -------------------------------------------------- |
| `pnpm format:check`        | 第一方格式检查，排除生成物、vendor 和 pnpm 锁文件  |
| `pnpm lint`                | ESLint 全仓库检查                                  |
| `pnpm typecheck`           | 各 workspace 的 TypeScript 检查                    |
| `pnpm test`                | workspace test，然后 `scripts/**/*.test.mjs`       |
| `pnpm test:coverage`       | 仅各 workspace 的 `test:coverage`                  |
| `pnpm docs:check`          | 契约漂移与维护文档的本地链接/标题锚点检查          |
| `pnpm architecture:check`  | 跨模块导入边界                                     |
| `pnpm browser-sinks:check` | 浏览器危险 sink 白名单                             |
| `pnpm bundle:check`        | 默认 userscript 构建和包体门禁                     |
| `pnpm check:quick`         | format:check、lint、typecheck、test 和主要静态门禁 |
| `pnpm check`               | `check:quick`、coverage、全仓库 build              |

`pnpm test` 会先执行每个 workspace 的 `test`，再执行根目录 `scripts/**/*.test.mjs`。因此根 Node 测试包括工作流 pin、Node/pnpm 版本、文档漂移、架构和浏览器 sink 规则；这些测试不属于 workspace Vitest。

`pnpm test:coverage` 调用 `pnpm -r test:coverage`，只覆盖 workspace 脚本，不包含根 `scripts/**/*.test.mjs`。它不能替代 `pnpm test`，也不能单独证明 CI `test` job 通过。CI `coverage-build` 还执行全仓库 `build` 和两个 userscript bundle budget profile。

Vitest 主要覆盖 TypeScript/运行时逻辑；包内显式列出的 Node `test` 覆盖构建器、配置解析、完整性契约和发布门禁。E2E 不会由 `pnpm test` 自动执行。

## 4. 根 `scripts/` 的职责

`scripts/` 按 `checks/`、`ci/`、[`docs-drift/`](../../scripts/docs-drift/)、`model/`、`ort-runtime/`、`e2e/` 和 `lib/` 分组。入口与测试位于各自领域；文档测试集中在 `docs-drift/test/`。当前布局与迁移记录见[目录组织](directory-layout.md)。

- [`check-architecture-boundaries.mjs`](../../scripts/checks/check-architecture-boundaries.mjs)：工作区和层间导入约束。
- [`check-browser-sinks.mjs`](../../scripts/checks/check-browser-sinks.mjs)：浏览器危险 API 及登记例外。
- [`check-bundle-budget.mjs`](../../scripts/checks/check-bundle-budget.mjs)：default 256 KiB 与 bundled 1 MiB 包体门禁。
- [`check-docs-drift.mjs`](../../scripts/docs-drift/check-docs-drift.mjs) 与 `docs-drift/`：从源码、配置和工作流提取事实，检查文档漂移。
- [`assert-pinned-actions.mjs`](../../scripts/ci/assert-pinned-actions.mjs) 与 `workflow-security-contract.test.mjs`：Action SHA、权限、条件和秘密门禁。同行 YAML flow 步骤中的每个 `uses` 均须检查，quoted 键、Action 引用与凭据值的标准转义先解码；checkout 的 `persist-credentials: false` 必须属于该步骤自身。plain scalar、续行、注释和 shell block 中的文本不充当工作流配置。检查器不是通用 YAML 解析器：多行 quoted key/Action 值，以及相关结构中的 anchor、tag、alias 等不支持写法会明确拒绝，不会静默放行。
- [`model-manifest.mjs`](../../scripts/model/model-manifest.mjs)、[`model-release-notes.mjs`](../../scripts/model/model-release-notes.mjs)：共享模型身份读取和发布说明。
- [`assert-clean-ort-source.mjs`](../../scripts/ort-runtime/assert-clean-ort-source.mjs)、[`build-minimal-ort-runtime.sh`](../../scripts/ort-runtime/build-minimal-ort-runtime.sh)、[`resolve-ort-build-root.mjs`](../../scripts/ort-runtime/resolve-ort-build-root.mjs)：独立 ORT 构建根保护。
- [`run-userscript-e2e.mjs`](../../scripts/e2e/run-userscript-e2e.mjs)：只转发受限的 userscript Playwright 参数。
- `scripts/lib/`：CLI、direct-run、源文件收集和字符串公共工具。

新增脚本应优先复用 `scripts/lib/`，避免重复根目录解析、直接运行判断或忽略目录列表。

## 5. 根配置职责

根 `package.json` 同时是 workspace 命令、Prettier 规则和包管理器版本声明的入口；`mise.toml` 只负责 Node.js/pnpm 工具版本；`pnpm-workspace.yaml` 负责 workspace、覆盖规则和单文档锁文件策略；`pnpm-lock.yaml` 只保存可冻结重放的 project dependency graph；`eslint.config.mjs` 是全仓库 flat config；`tsconfig.base.json` 提供共享 TypeScript 编译选项；`.prettierignore` 保持生成物、vendor 和锁文件的忽略边界。已删除的 `prettier.config.js` 和 `vitest.workspace.ts` 不再是配置来源。修改根配置后至少运行 `format:check`、`lint`、根 Node 测试、冻结安装和 `docs:check`。

## 6. Model Worker 测试配置

测试和静态检查使用占位绑定，不得使用生产 KV、R2 标识或生产 Key：

```bash
MODEL_KEYS_KV_NAMESPACE_ID=test-kv \
MODEL_BUCKET_NAME=test-bucket \
mise exec -- pnpm --filter @hv-pony-solver/model-worker render-config
```

之后运行离线检查：

```bash
mise exec -- pnpm --filter @hv-pony-solver/model-worker typecheck
mise exec -- pnpm --filter @hv-pony-solver/model-worker test
```

`check:deployment` 需要线上绑定、配置或服务可达性时才执行。它不是离线单元测试；执行时必须明确记录目标环境、是否使用受保护凭据以及探测结果，不能用占位绑定把部署探测伪装成通过。

`apps/model-worker/wrangler.toml` 是生成物，不应手工编辑或提交；权威来源是 `apps/model-worker/wrangler.template.toml` 和渲染器。CI 测试 job 使用占位绑定，部署 job 只有秘密完整时才使用 deploy 环境变量；未勾选发布时可安全跳过线上探测，显式发布但缺少秘密必须 fail closed。

运行根 `pnpm check` 前，若当前没有可复用的测试配置，先用上面的 `test-kv` 和 `test-bucket` 渲染配置；若工作区已有真实或受保护的 `wrangler.toml`，先保存其状态并确认渲染目标，不要无说明地覆盖。配置生成属于有副作用的准备步骤，不应在仅审阅源码时自动执行。

## 7. 浏览器证据边界

```bash
mise exec -- pnpm test:e2e:userscript
mise exec -- pnpm test:e2e:extension:content
mise exec -- pnpm test:e2e:extension:chromium:load-only
mise exec -- pnpm test:e2e:extension:firefox:load-only
mise exec -- pnpm test:e2e:extension:packaged
```

Chromium 与 Firefox、远程模型与内置模型、内容脚本 smoke 与实际推理分别是不同证据。最低版本 job 使用 Chromium 116 和 Firefox 140，证明最低支持版本上的内置包行为。Firefox Android 142 发布证据来自受信任的外部工作流，并由发布 job 校验 run ID、commit SHA、workflow ID、事件和证据文件；本地桌面 Firefox 不能替代它。

没有受保护生产凭据时，不能把 load-only、fixture 或未执行的 authenticated smoke 描述为真实模型鉴权推理。`extension-remote-authenticated-e2e` 在配置未启用时状态为 skipped，不产生鉴权证据；如果显式要求执行鉴权路径而缺少 Key，必须 fail closed。受保护 Key 只允许在显式 CI environment 中读取，不能出现在日志、测试快照、URL 或文档。

## 8. CI job 与本地命令

[`verify-monorepo.yml`](../../.github/workflows/verify-monorepo.yml) 当前包含 15 个 job：

| job                                | 本地对应                                                  | 证明内容                                                              |
| ---------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| guardrails                         | lint、typecheck、audit、docs、architecture、browser-sinks | 静态、文档、边界和依赖安全                                            |
| codeql                             | 无本地等价物                                              | GitHub CodeQL 分析和告警连续性；扩展发布等待本次分析作业成功          |
| dependency-review                  | 无本地等价物                                              | PR 依赖 high 严重度门禁                                               |
| test                               | pnpm test                                                 | workspace 和根 Node 测试                                              |
| coverage-build                     | test:coverage、build、两个 bundle:check                   | 覆盖率、构建和 userscript 包体                                        |
| userscript-e2e                     | test:e2e:userscript                                       | Chromium userscript smoke                                             |
| extension-e2e                      | content、远程 Chromium/Firefox、benchmark:ci              | 扩展传输、桌面加载和有限性能                                          |
| extension-remote-authenticated-e2e | authenticated 命令                                        | 受保护远程模型鉴权；未启用时 skipped，显式执行缺 Key 必须 fail closed |
| extension-minimum-versions-e2e     | 精确浏览器加 packaged smokes                              | Chromium 116、Firefox 140                                             |
| extension-packaged-e2e             | packaged fixture 加双浏览器 smoke                         | 内置模型推理                                                          |
| extension-canonical-packaged-e2e   | canonical 下载、build:packaged、双浏览器                  | 发布前 canonical 桌面证据                                             |
| firefox-android-142-release-gate   | 无本地等价物                                              | 外部 Android 142 证据绑定                                             |
| userscript-artifact                | bundled build、bundle:check:bundled                       | 手动用户脚本 artifact                                                 |
| extension-artifact                 | release-gate preflight                                    | 内置扩展 artifact 发布门禁                                            |
| extension-release                  | release-gate preflight 加 Release API                     | main 分支远程模型桌面 ZIP 发布                                        |

[`deploy-cloudflare-model-worker.yml`](../../.github/workflows/deploy-cloudflare-model-worker.yml) 是独立手动部署流程：要求 main，先审计依赖、渲染配置、typecheck、worker tests 和 Wrangler dry-run；未勾选发布且缺少秘密时跳过线上 dry-run/deploy，显式勾选发布但四项 Cloudflare 配置不完整时必须 fail closed，不用伪造值。

CI 多个 job 重复安装 mise、解析 pnpm store、缓存依赖和安装浏览器。未来可抽取 composite action，但必须保持权限、条件、缓存 key、environment 和发布依赖图；改动后运行 `benchmark-workflow-cost.test.mjs`、`workflow-security-contract.test.mjs` 和完整 CI。

## 9. 包体、ORT 与生成物

default userscript profile 由 `bundle:check:default` 检查，预算 256 KiB；bundled profile 由 `bundle:check:bundled` 检查，预算 1 MiB。两个 profile 必须分别报告，压缩构建不能替代默认门禁。

精简 ORT 构建可能下载源码、创建 Python 环境、编译大型资产并清理独立构建根目录。普通审查不要随意运行 `build-minimal-ort-runtime.sh`；优先运行 Node 测试和静态检查。

以下是本地或 CI 生成物，不应作为普通源码提交：

- `apps/*/dist/`、ZIP、校验文件、artifact manifest 和 metafile；
- `coverage/`、由 [wrangler.template.toml](../../apps/model-worker/wrangler.template.toml) 生成的 `apps/model-worker/wrangler.toml`；
- `config/` 下的渲染配置和 ORT operator 配置；
- `other/` 下的运行时输出；
- Playwright、Firefox/geckodriver、本地浏览器临时目录；
- 下载模型、Key、日志和 E2E 证据。

验证结束执行：

```bash
git status --short --branch
git diff --check
```

不得用 `git reset --hard` 或 `git checkout --` 清理用户改动。

## 10. 目录、贡献和注释规范

目录分组建议、迁移顺序和“单目录不要堆放大量文件”的约束见 [`directory-layout.md`](directory-layout.md)。提交范围、代码风格、注释要求和文档同步规则见 [`contributing.md`](contributing.md)。这两份文档由仓库审计任务维护；本页只保留验证相关内容。

移动文件前必须同步 package script、README、工作流、测试路径和 docs-drift 读取，再分组运行完整 `pnpm check`。注释应解释安全边界、失败关闭、生成物生命周期或测试证据限制；重复描述代码表面行为的注释应删除。新增脚本应提供 CLI 用法和错误上下文，跨边界输入从 `unknown` 校验，避免 `any`、非空断言和隐式兼容路径。

## 11. 提交前检查清单

提交前默认运行：

```bash
mise exec -- pnpm check
node scripts/ci/assert-pinned-actions.mjs
git diff --check
```

如果只修改了局部区域，仍须运行对应的最小命令；发布前不能省略 `extension:package-check`、`bundle:check` 或受影响的浏览器证据。

环境缺少浏览器、geckodriver、Cloudflare 凭据或受保护模型 Key 时，应明确列出未运行的 job、原因和替代证据。静态检查通过不等于页面 E2E、真实远程鉴权、最低版本浏览器或 Firefox Android 发布证据通过。
