# 开发与验证手册

所有命令在仓库根目录执行。先准备环境，再选择能证明改动的最小验证；提交前执行完整检查，按实际结果记录证据。命令索引见[命令参考](commands.md)，发布条件见[CI 与发布](releases.md)。

## 工具链与工作区

先按[工具链安装步骤](commands.md#工具链)安装依赖。[mise.toml](../../mise.toml) 统一固定本地与 CI 版本，根 [package.json](../../package.json) 保留最低 Node 兼容要求和 pnpm 声明；不再增加 `.node-version`、Corepack 或 `setup-node` 作为第二来源。日常命令使用 `mise exec -- pnpm`。

[pnpm-workspace.yaml](../../pnpm-workspace.yaml) 保持以下约束：

- `pmOnFail: ignore` 使 pnpm 12 只维护 project lock，避免 package-manager environment document 影响 GitHub Dependency Graph/Review；版本一致性由 mise、包声明、冻结安装和 `scripts/ci/node-version-contract.test.mjs` 保证。
- `blockExoticSubdeps: true`、`trustPolicy: no-downgrade`；`minimumReleaseAge` 与 `trustPolicyIgnoreAfter` 均为 10080 分钟（7 天）。Cloudflare Workers 类型包的例外按精确版本列出，不扩大豁免。

工作区职责见[整体架构](../architecture/overview.md)。新增跨包导入、移动目录或修改 package export 后运行 `architecture:check`；类型边界同时检查 `import type`、`import('…').Type` 与 `typeof import('…')`。

## Model Worker 测试配置

包含 Worker 的测试或构建（包括根 `pnpm check`）前准备占位绑定。`apps/model-worker/wrangler.toml` 是生成物；已有自定义配置时，先在仓库外备份，验证后按字节恢复，禁止输出其中的绑定或凭据。不要手改或提交生成配置，权威来源是 [wrangler.template.toml](../../apps/model-worker/wrangler.template.toml) 和渲染器。

```bash
MODEL_KEYS_KV_NAMESPACE_ID=test-kv \
MODEL_BUCKET_NAME=test-bucket \
mise exec -- pnpm --filter @hv-pony-solver/model-worker render-config
```

然后运行离线检查：

```bash
mise exec -- pnpm --filter @hv-pony-solver/model-worker typecheck
mise exec -- pnpm --filter @hv-pony-solver/model-worker test
```

配置渲染测试只按白名单复制模板和必需脚本，不递归复制生成的 `wrangler.toml`、环境文件或 `.wrangler/` 本地状态。普通测试不用生产 KV/R2 标识或 Key。`check:deployment` 是独立线上探测，需要明确目标环境和服务可达性，不能用占位绑定代替线上证据。部署 job 的 secrets、dry-run 和发布条件见[部署工作流](releases.md#model-worker-部署工作流)。仅审阅源码不需要渲染配置。

## 按修改区域选择验证

先运行定向测试，再按影响的边界扩大；各工作区完整命令见[命令参考](commands.md)。

| 修改区域                           | 最小验证                                  | 补充验证                                     |
| ---------------------------------- | ----------------------------------------- | -------------------------------------------- |
| shared 契约或资产                  | shared `typecheck`、`test`                | 文档漂移与受影响应用                         |
| browser-core DOM、答题、面板或推理 | browser-core `typecheck`、`test`          | 架构、危险调用、页面 E2E                     |
| 用户脚本构建或 Runtime             | userscript `typecheck`、`test`、`build`   | 两个 bundle profile、页面 E2E                |
| 扩展消息、权限、缓存或打包         | extension `typecheck`、`test`、对应构建   | content、双浏览器、remote/packaged、最低版本 |
| Worker 路由、额度或配置            | 测试配置、worker `typecheck`、`test`      | 文档漂移；需要线上验收时另做部署探测         |
| scripts、根配置或工作流            | 对应 Node 测试或 `pnpm test`              | 格式、lint、相关静态门禁与 Action pin        |
| README 或 docs                     | [文档验证](documentation.md#验证文档修改) | vendor Runtime README 单独检查               |

公开命令、默认值、路由、资产或构建变化按[文档联动表](documentation.md#按修改类型同步)检查 README、专题、测试和漂移提取器。

## 根命令与测试分层

`pnpm test` 先执行工作区普通测试，再调用 `pnpm test:root` 运行根级 `scripts/**/*.test.mjs`，其中包括工作流、工具版本、文档和边界检查器的回归。`pnpm test:coverage` 只调度工作区覆盖率，不含根级测试，单独运行不能替代 `pnpm test`。完整 `pnpm check` 执行一次工作区覆盖率测试，再执行一次 `test:root`，不重复普通工作区测试；`check:quick` 和 CI 独立 test/coverage-build job 的行为不变。

Vitest 主要验证 TypeScript/运行时逻辑；包内 Node 测试覆盖构建器、配置、完整性和发布工具。`pnpm check` 的[完整顺序](commands.md#仓库级命令)包含格式、静态门禁、测试、覆盖率和构建，但不自动执行浏览器 E2E 或联网依赖审计。依赖变更另运行 `mise exec -- pnpm audit:high`，与 CI 的 High 门槛一致。

### 测试归属与精简

- 共用 DOM、答题、推理、模型下载和历史逻辑归 browser-core；用户脚本只补 GM、菜单、存储和 Runtime 适配，不重复整套共用行为。
- 删除等价用例前指出仍保留的行为断言；取消时点、手动答案归属、Key 隔离、事务身份、来源校验和既有缺陷回归不能仅凭行覆盖率删除。
- 文档静态关键词检查按校验分支和每篇专题选代表负例；保留逐篇失败、README 不能补足专题、源码提取和伪装事实的负例，不逐词重复全仓扫描。
- 清单共有字段的负例覆盖两种后台形态，不重复四种模型/浏览器组合；四种有效清单、权限/CSP/模型身份差异、危险 HTML 及产物/E2E 矩阵仍独立验证。
- WASM 单测用小型确定性字节和对应测试身份驱动真实读取/哈希路径，不反复深比较完整 WASM；真实文件身份归构建审计与浏览器 E2E。
- 不降低覆盖率门槛，不用 skip/todo、改 include 或合并用例计数冒充精简；[精简决定](../decisions/implemented/testing/2026-10-14-test-suite-ownership.md)记录归属和取舍。

## 浏览器证据边界

| 证据                       | 能证明什么                                         | 不能代替什么             |
| -------------------------- | -------------------------------------------------- | ------------------------ |
| userscript E2E             | Playwright Chromium 中的用户脚本流程               | 其他管理器、生产鉴权     |
| extension content          | 临时确定性 Host 的内容脚本整链行为                 | 正式模型推理             |
| remote load-only           | Chromium 加载/普通设置、Firefox 实际 ZIP/设置控件  | Key 鉴权与模型推理       |
| authenticated              | 受保护 Key 下载、完整性校验后至少一次真实 `detect` | 内置模型与其他浏览器     |
| packaged fixture/canonical | 无 Key 推理与会话重建，结果绑定实际 ZIP            | 彼此的模型身份、远程鉴权 |
| 精确最低版本               | Chromium 116、Firefox Desktop 140 的内置包行为     | 更高版本或 Android       |
| Firefox Android 142        | 受信任外部 run 对同一 Firefox ZIP 的成功推理       | 本地桌面 Firefox         |

内置模型 smoke 关闭随机回退，核对 checkbox index/confidence；fixture 还需匹配 artifact 的预期结果。Chromium 加载已校验 ZIP 的解压目录，Firefox 临时安装实际 ZIP。最低版本 job 设置 `REQUIRE_EXACT_MINIMUM_BROWSER=true`，更高浏览器版本不能冒充覆盖。工具安装、命令和证据格式见[扩展手册](../browser-extension.md)。

显式执行 authenticated 命令但缺 Key 时必须失败。CI 的远程鉴权 job 有两种跳过情形：条件不满足时整个 job 为 skipped；job 已启动但缺 Key 时输出 `enabled=false`，后续 smoke 跳过，job 本身仍可能成功。发布必须同时要求 job 成功和 `outputs.enabled == 'true'`，不能只看绿色状态。受保护凭据只从指定环境读取，不写入日志、快照、URL 或文档。Chromium 鉴权 smoke 拒绝非空 `DEBUG`/`PWDEBUG`，并截断 Key 输入失败的原始异常链；脱敏回归只用公开假值和离线页面。

## CI job 与本地命令

[Repository CI](../../.github/workflows/verify-monorepo.yml) 的对应关系如下，运行条件以 workflow 为准：

| job                                | 本地入口或范围                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| guardrails                         | Action pin、`audit:high`、格式、lint、typecheck、docs、architecture、browser-sinks                                   |
| codeql                             | GitHub CodeQL，无本地等价物；扩展发布依赖本次分析成功                                                                |
| dependency-review                  | PR high 严重度依赖门禁，无本地等价物                                                                                 |
| test                               | `pnpm test`，含根级 Node 测试                                                                                        |
| coverage-build                     | `test:coverage`、`build`、两个用户脚本 bundle profile                                                                |
| userscript-e2e                     | `test:e2e:userscript`                                                                                                |
| extension-e2e                      | content、remote 双浏览器 load-only、`benchmark:ci`；首次完整 ZIP 上传等待全部远程发布门禁                            |
| extension-remote-authenticated-e2e | authenticated；同时核对 job 状态和 enabled 输出                                                                      |
| extension-minimum-versions-e2e     | 精确 Chromium 116/Firefox 140 加 packaged smoke                                                                      |
| extension-packaged-e2e             | 确定性 fixture 加桌面双浏览器 smoke                                                                                  |
| extension-canonical-packaged-e2e   | canonical 下载、`build:packaged`、桌面双浏览器；显式发布时校验外部 Android 142 run、同一 ZIP 与 preflight 后首次上传 |
| userscript-artifact                | bundled 构建/预算及手动 artifact 上传                                                                                |
| extension-artifact                 | canonical 内置包发布 preflight                                                                                       |
| extension-release                  | 复用已测试 remote ZIP，校验身份后创建 Release                                                                        |

`benchmark:ci` 只测浏览器 Blob 复制与全缓冲 digest，虽绑定扩展产物身份，并未测量扩展消息、prepare、detect 或缓存；实际链路由独立 product 基准测量。基准不提供发布或准确率证据。

修改 CI 时核对实际命令、权限、条件和 `needs`，保留根级 Node 测试及各浏览器独立证据；回归位于 `scripts/ci/`。独立的[Worker 部署工作流](releases.md#model-worker-部署工作流)不属于普通 Repository CI。

## 包体、ORT 与生成物

默认用户脚本预算 `256 KiB`，内置 Runtime 预算 `1 MiB`。分别执行对应构建和 `bundle:check:default` / `bundle:check:bundled`，避免后一次构建覆盖前一次待查产物；压缩构建不能替代默认门禁。

精简 ORT 构建涉及下载、Python 环境、大型资产编译和构建根清理，前提见[Runtime 专题](../onnx-runtime.md)。普通文档或源码审阅优先使用已有资产、Node 测试和静态检查。

`dist/`、coverage、ZIP/manifest/metafile、生成的 `wrangler.toml`、`config/`、`other/` 运行时输出、下载模型、临时浏览器目录和 E2E 证据均不作为普通源码提交。验证后恢复备份配置，检查工作区，保留原有用户改动；不用 `git reset --hard` 或 `git checkout --` 清理。

## 交付前检查

准备测试配置后，提交前默认执行：

```bash
mise exec -- pnpm check
mise exec -- node scripts/ci/assert-pinned-actions.mjs
git diff --check
```

此外运行受影响的浏览器 E2E；纯文档任务按下一节验证即可。检查 `git status --short --branch`、`git diff` 和 `git diff --cached`，确认只有预期文件。只有用户明确要求才创建 commit、push、发布或部署。

## 格式、链接和检查器

纯文档至少运行 `mise exec -- pnpm format:check`、`mise exec -- pnpm docs:check`、`mise exec -- node --test "scripts/docs-drift/test/*.test.mjs"` 和 `git diff --check`。vendor Runtime README 不在默认门禁范围，单独检查方式见[文档维护](documentation.md#验证文档修改)。修改检查器再运行 lint 和对应 Node 回归。

格式来自根 `package.json`，忽略范围来自 `.gitignore` 与 `.prettierignore`；只对改动文件运行 Prettier `--write`。Action pin 检查要求完整 SHA/digest 及当前 checkout 步骤的凭据配置，对不支持的相关语法失败关闭；它并非通用 YAML 解析器。

## 验证记录格式

交付写明命令、结果、生成物处理和未运行项；远程证据加 run URL、commit、浏览器版本及产物身份。缺少浏览器、驱动或受保护凭据时说明限制和已有替代验证。公开 HEAD/OPTIONS、fixture/load-only、当前浏览器和 CodeQL 作业成功分别不证明真实鉴权、最低版本或无安全告警；历史通过数只属于原记录。
