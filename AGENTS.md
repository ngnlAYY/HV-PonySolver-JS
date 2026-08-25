# AGENTS.md — HV-PonySolver-JS

本文档适用于仓库根目录及其全部子目录，用于约束自动化代理和人工维护者的开发、验证与交付方式。若后续某个子目录增加更具体的 `AGENTS.md`，则该文件只覆盖其所在目录及下级目录；未覆盖部分仍遵循本文档。

最后复核：2026-08-25。

## 项目定位

HV-PonySolver-JS 是一个面向 Hentaiverse Pony 验证码的 TypeScript/pnpm 单仓库，包含用户脚本、Chromium/Firefox MV3 扩展、Cloudflare Model Worker 和共用浏览器核心。

当前可分发客户端版本以各应用的 `package.json` 为准：用户脚本为 `3.0.0`，浏览器扩展为 `0.1.1`。根包、内部包和 Model Worker 的私有包版本不代表扩展版本，修改时不得为了“统一版本号”而联动升级无关工作区。

必须始终保留以下产品边界：

- 验证码图片预处理、ONNX Runtime Web 推理和答案选择均在浏览器本地完成；图片与识别结果不得发送给 Model Worker。
- 用户脚本与扩展共享 DOM、答题、推理和模型契约，但各自维护平台适配器、存储和构建入口。
- Model Worker 只负责 Key 鉴权、模型与运行时资产分发、每 Key 下载额度及对应 HTTP 契约。
- 扩展同时支持远程模型版和内置模型版。内置模型版不得保留远程模型下载、Key 读取或远程模型 Host 权限。
- README、补充文档、测试、资产清单与源码共同构成项目契约；修改其中一处时必须检查其他位置是否需要同步。

## 开始工作前

1. 先阅读本文件、`README.md` 以及与任务直接相关的 `docs/` 文档。
2. 检查 `git status --short --branch`，保留用户已有改动，不得擅自覆盖、清理或重置。
3. 仓库根目录存在 `.codegraph/` 时，定位符号、调用链或架构关系应先使用 `codegraph explore`，再按需读取具体文件。
4. 优先做范围最小、可验证的修改；不要借当前任务进行无关重构、依赖升级或格式化全仓库。
5. 任何 Key、Bearer token、Cloudflare 凭据和受保护测试值都视为秘密，不得写入源码、测试夹具、文档、日志、URL、提交信息或构建产物。

## 仓库结构与职责

| 路径                    | 职责                                                                              |
| ----------------------- | --------------------------------------------------------------------------------- |
| `apps/userscript`       | 用户脚本入口、GM 平台桥接、用户脚本构建与浏览器测试                               |
| `apps/extension`        | Chromium/Firefox 扩展入口、后台代理、推理 Host、设置页、打包与浏览器测试          |
| `apps/model-worker`     | Cloudflare Worker、Key 鉴权、R2 资产响应、Durable Object 下载额度及 Wrangler 配置 |
| `packages/browser-core` | 用户脚本和扩展共用的 DOM、验证码、答题、推理、模型下载、状态面板与平台接口        |
| `packages/shared`       | 浏览器端和 Model Worker 共用的模型、答案、令牌及 ORT 资产契约                     |
| `scripts`               | 仓库级校验、文档漂移、架构门禁、包体预算、E2E 和发布辅助脚本                      |
| `docs`                  | 扩展架构、模型缓存策略、Model Worker 运维和 ONNX Runtime 补充文档                 |
| `model`                 | 内置扩展构建使用的本地固定模型输入；大体积模型不应随意纳入 Git                    |
| `other`                 | 可供人工上传或归档的运行时生成物，不是默认源码入口                                |
| `config`                | 本地生成配置；已被 Git 忽略，不得重新跟踪                                         |
| `.github/workflows`     | 仓库 CI 与 Model Worker 手动部署流程                                              |

## 依赖方向与模块边界

- `packages/shared` 应保持与浏览器 DOM、GM API、WebExtension API 和 Cloudflare 运行时无关。
- `packages/browser-core` 可以依赖 `packages/shared`，但必须通过平台接口接收存储、网络和页面能力，不能直接依赖用户脚本或扩展实现。
- `apps/userscript` 和 `apps/extension` 可以依赖共用包，但彼此不得直接导入源码。
- `apps/model-worker` 可以依赖 `packages/shared` 的纯契约，不得导入浏览器端应用代码或 DOM 逻辑。
- 超时、状态面板、模型资产和协议常量应继续由各自权威模块集中管理，不得在调用方复制一套隐式常量。
- 新增跨包导入或移动文件后必须运行 `architecture:check`；不要通过深层相对路径绕开 package export 或架构门禁。

## 浏览器端关键不变量

### 答案与提交

- 默认开启“保留已勾选答案”，允许用户在自动识别期间手动答题。
- 手动勾选和程序自动勾选必须可区分；程序不得撤销手动勾选。
- 保留模式下，已自动勾选项可以参与下一次识别结果合并。合计选中数不超过 4 时保持现状；超过 4 时，仅从自动项中按置信度从低到高移除，目标为至多 3 项。
- 若手动项本身已达到或超过目标数量，不得为满足数量限制而取消手动项。
- 关闭保留模式时，程序可以清空当前勾选并接管本轮答案选择，但仍必须在提交前重新确认表单、checkbox 和按钮仍是同一组可用控件。
- 答案控件数量、连接状态、所属表单、禁用状态或提交按钮异常时应停止本轮处理；不得对已替换或失效的 DOM 继续点击。
- DOM 观察可能连续触发，同一验证码的同类失败必须经过冷却或去重，避免日志和面板记录无界刷屏。
- 自动模式只允许一次原生提交；取消、超时、路由切换或新验证码到达后，旧任务不得继续点击或提交。

### 状态面板

- 默认位置为 `top=155, left=1240`。
- “仅在页面存在 `div#csp` 时显示面板”默认开启，并允许用户显式关闭。
- 面板隐藏不等于停止识别；修改可见性逻辑时要分别验证面板状态和答题流程。
- 状态与历史记录必须有数量上限。高频重复错误应聚合，不得无限扩张 DOM、内存或持久化记录。
- 面板渲染使用安全 DOM API；新增 `innerHTML`、动态代码构造或其他浏览器危险调用会触发安全门禁，原则上不得加入白名单。

### 平台、存储与网络

- 用户脚本通过 GM 桥接访问特权 API；扩展内容脚本不得接收模型 Key 或模型字节。
- 扩展远程模型 Key 只保存在扩展源 IndexedDB；普通设置和历史使用 `storage.local`。不得把 Key 降级保存到页面存储、查询字符串或可回显控件。
- 调用原生 `fetch` 时必须保留正确接收者，使用项目已有的 fetch 解析辅助函数，避免 `Illegal invocation`。
- 跨上下文消息必须执行严格 schema、来源、大小、超时和取消校验。不要把 `unknown` 消息直接断言为可信类型。
- 验证码图片消息保持明确的大小上限；模型字节使用可转移 `ArrayBuffer`，不得改为无界 Base64 或重复拷贝。
- 异步识别遵循 latest-wins：旧请求完成得更晚时也不能覆盖新请求状态。

## 模型、运行时与扩展产物

- 当前 ORT 模型和定制 WASM 的文件名、URL、对象键、字节长度与 SHA-256 是一组原子契约。替换资产时必须同步共享清单、Worker 配置、构建器、测试和文档。
- 模型和 WASM 下载必须拒绝重定向，并同时执行最大长度、声明长度、实际长度和 SHA-256 校验；失败内容不得进入缓存。
- 远程扩展只有在完整读取、校验并成功写入 IndexedDB 后，才可向后端确认一次下载。
- 内置扩展构建只接受仓库约定的固定模型输入，构建产物必须审计模型身份、CSP、权限、Host 权限、动态导入和远程可执行代码。
- 扩展 JS、Worker、ORT glue 和 WASM 必须随包分发；不得引入远程可执行代码。
- 远程扩展产物不得包含 `.ort`；内置扩展产物必须且只能包含清单声明的一个 `.ort`。
- 扩展不得声明 `web_accessible_resources` 或图片资源；如产品需求确需改变，必须同时更新威胁模型、构建审计、测试和文档。
- 构建输出目录、覆盖率、生成的 Wrangler 配置和下载模型属于生成物，不应作为普通源码提交。

## Model Worker 与额度规则

- 模型 Key 只接受 `Authorization: Bearer <64 位十六进制值>`；查询字符串 Key 永远不得授权真实模型。
- Key 规范化必须统一；Durable Object 身份按规范化 Key 的不可逆摘要隔离，禁止使用全局计数器或在日志中输出原始 Key、规范化 Key、摘要或额度状态。
- 额度限制默认开启，按每个 Key、每个 UTC 自然月最多 5 次已确认下载计算。ONNX 与 ORT 共用同一 Key 的额度。
- `GET /quota` 只查询，不计次；真实模型 `GET` 只预留临时回执，不立即计次；客户端成功缓存后使用 `POST /quota` 确认，确认成功才计次。
- 同一回执重复确认必须幂等；未知、失效或未完成的回执不得计次。并发预留必须受硬上限约束，不能通过并发请求突破月度额度。
- 关闭额度限制时，模型下载不做次数限制，查询接口必须明确返回“未启用/无限制”，不能伪造剩余次数。
- 模型、额度和公开运行时路由使用各自的 CORS 方法、请求头及公开/私有策略。修改路由时不得重新合并成过宽的全局 CORS 常量。
- `HEAD`、`OPTIONS`、诱饵模型和运行时资产不计额度。模型响应保持 `no-store`；内容寻址运行时可使用长期 immutable 缓存。
- R2 对象缺失或完整性契约异常时应失败关闭，不得静默回退到其他对象。
- Durable Object 绑定、类导出和迁移是持久状态契约。回滚时不得部署一个删除相关绑定或迁移的旧版本。

## 编码与文档规范

- 使用 TypeScript 严格类型和 ESM；跨边界输入从 `unknown` 开始验证，避免无依据的类型断言、`any` 和非空断言。
- 遵循现有 ESLint、Prettier 和局部代码风格。仅格式化本次涉及的文件，避免产生无关 diff。
- 命名应表达领域含义；协议字段、HTTP 头和外部 API 名称保留其标准英文拼写。
- 面向用户的提示、错误和设置说明使用清晰中文；注释重点解释原因、约束和安全边界，不重复代码表面行为。
- 错误应保留真实原因和可诊断上下文，但在 UI 或响应中不得泄露 Key、内部对象标识或敏感配置。
- 网络断开、HTTP 错误、解析失败、完整性失败和额度拒绝应尽量区分；不要用统一的“连接已断开”掩盖后端真实错误。
- 修改公开行为、命令、默认值、路由、响应头、资产或构建方式时，同步更新 `README.md`、相关 `docs/`、测试以及 `scripts/check-docs-drift*`。
- `apps/model-worker/wrangler.template.toml` 是 Wrangler 配置权威来源；生成的 `wrangler.toml` 不应手工维护。

## 配置与秘密

- 不提交 `.env`、Key、Cloudflare token、KV/R2 标识、受保护 E2E 凭据或包含这些值的日志。
- `config/` 是可再生且被忽略的目录，不得使用强制添加重新纳入远程分支。
- GitHub Actions 中的部署值通过受保护的 secrets/variables 和手动输入传入；默认工作流不得因缺少生产凭据而意外执行生产下载或部署。
- 测试必须使用明确的测试占位绑定或进程内 fixture；生产 Key 不得出现在单元测试快照中。
- 需要真实 Key 的鉴权 E2E 必须 fail closed，并只在受保护环境显式启用。普通 CI、内容脚本 E2E 和内置模型 E2E 不得访问生产模型服务。

## 测试与验证

项目要求 Node.js `>=24.15.0`，并由 `package.json` 固定 `pnpm@11.21.0`。优先使用 `corepack pnpm`，不要让不兼容的全局 pnpm 接管脚本。

先运行与改动直接相关的最小测试，再按风险扩大范围。常用定向命令：

```bash
corepack pnpm --filter @hv-pony-solver/browser-core test
corepack pnpm --filter @hv-pony-solver/userscript test
corepack pnpm --filter @hv-pony-solver/extension test
corepack pnpm --filter @hv-pony-solver/model-worker test
node --test scripts/check-docs-drift.test.mjs
```

提交前的默认完整检查：

```bash
corepack pnpm check
node scripts/assert-pinned-actions.mjs
git diff --check
```

`corepack pnpm check` 包含 lint、类型检查、工作区与根级测试、文档漂移、架构边界、浏览器危险调用、扩展打包、包体预算、覆盖率和全仓库构建。

特别注意：

- `corepack pnpm test` 会先执行各工作区测试，再执行 `scripts/**/*.test.mjs` 根级测试。
- `corepack pnpm -r test:coverage` 不包含根级 `scripts/**/*.test.mjs`；它不能替代 `corepack pnpm test`，也不能单独证明 GitHub Actions 的 `test` job 会通过。
- Model Worker 测试或配置改动前，按 CI 方式生成测试配置：

```bash
MODEL_KEYS_KV_NAMESPACE_ID=test-kv \
MODEL_BUCKET_NAME=test-bucket \
corepack pnpm --filter @hv-pony-solver/model-worker render-config
```

- 修改默认或内置用户脚本运行时后，分别检查对应 bundle profile，不能用一个预算替代另一个。
- 修改扩展构建、安全边界或浏览器协议后，至少运行相关扩展构建和 E2E；远程、内置、Chromium、Firefox、最低版本与 Firefox Android 证据证明不同边界，不能互相替代。
- 没有受保护 Key 时，不得把 load-only 测试描述成已完成真实模型鉴权推理。

如果完整检查因环境能力缺失而无法执行，应明确记录未运行项目、原因和替代验证，不得笼统声称“全部通过”。

## GitHub Actions 与部署

- 仓库只维护两个工作流：`.github/workflows/verify-monorepo.yml` 的 `Repository CI`，以及 `.github/workflows/deploy-cloudflare-model-worker.yml` 的手动部署流程。
- 外部 Action 必须固定到完整 40 位 commit SHA，并通过 `scripts/assert-pinned-actions.mjs` 校验。
- 修改 CI 时要核对本地命令与 job 实际命令，尤其不能遗漏根级 Node 测试。
- CodeQL 属于仓库安全门禁。修复告警后要等待目标分支的新分析完成，并同时检查最新分析结果和告警实例状态。
- Model Worker 部署默认不应发生。只有手动输入明确允许发布且 Cloudflare secrets 完整时才可执行真实部署。
- 下载额度开关属于部署配置：构建或部署选择无限制时，客户端额度查询必须显示未启用限制，而不是显示一个虚假的有限次数。
- 工作流文件数量应保持精简；合并 job 或 workflow 时必须保留权限最小化、条件执行、发布门禁和已有 Code Scanning 连续性。

`Repository CI` 的手动发布入口必须按产品类型区分：

- `publish_userscript_artifact` 只上传用户脚本 Actions artifact，不创建 GitHub Release。
- `publish_extension_release` 只允许从 `main` 创建 `extension-v<apps/extension/package.json version>`，发布远程模型桌面 Chromium/Firefox ZIP、校验文件和 artifact 元数据；默认关闭，不代表浏览器商店发布或 Firefox Android 验证。
- `publish_extension_artifact` 发布内置模型扩展 artifact，必须通过 canonical 模型、桌面双浏览器、受保护远程模型和同一 Firefox ZIP 的 Android 142 外部证据门禁。
- 普通 push、Pull Request 和未勾选发布输入的手动运行不得创建 Release 或发布生产 artifact。

## Git 与交付纪律

- 不使用 `git reset --hard`、`git checkout --` 或其他破坏性命令清理用户改动。
- 提交前检查 `git status`、`git diff`、`git diff --cached` 和 `git diff --check`，确认只包含本任务文件。
- 不提交 `dist/`、`coverage/`、生成的 `wrangler.toml`、`config/`、临时浏览器配置、测试证据、下载模型或含秘密的文件。
- commit 信息应概括行为变化，不使用含糊的“update/fix stuff”。
- 只有用户明确要求时才创建 commit、push、发布 artifact 或部署；推送前确认远程分支没有未整合的新提交。
- 推送后若任务要求 CI 或安全复核，应等待对应 commit 的远程检查结束再报告结果；仅“已触发”不等于“已通过”。

## 本文件的维护

出现下列变化时，应在同一改动中更新本文件：

- 新增、删除或重命名工作区、关键目录或 GitHub Actions 工作流。
- 调整用户脚本、扩展、共用包或 Model Worker 的依赖方向。
- 修改答题、面板、Key 存储、模型下载、完整性校验、额度确认或 CORS 的关键不变量。
- 更换 Node/pnpm 版本、完整验证命令、发布门禁或部署方式。
- 本文列出的命令、默认值或安全约束已不再符合源码。

维护时以当前源码、测试和工作流为依据，参考历史文档结构但不要保留与本项目无关的规则。更新后至少执行 Markdown 格式检查、`git diff --check` 和受影响的文档漂移测试。
