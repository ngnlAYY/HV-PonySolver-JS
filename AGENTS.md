# AGENTS.md — HV-PonySolver-JS

适用于仓库及全部子目录；更具体的 `AGENTS.md` 仅覆盖其目录。最后复核：2026-10-15。

## 项目定位

TypeScript/pnpm 单仓库，包含用户脚本、Chromium/Firefox MV3 扩展、Cloudflare Model Worker 和共用浏览器核心。客户端版本以应用 `package.json` 为准：用户脚本 `3.0.0`、扩展 `0.1.1`；私有根包、内部包和 Worker 版本独立，不联动升级。

- 图片预处理、ONNX Runtime Web 推理和答案选择均在浏览器本地完成；图片与识别结果不发送给 Model Worker。
- 用户脚本与扩展共享 DOM、答题、推理和模型契约，各自维护平台适配、存储和构建入口。
- Model Worker 只负责 Key 鉴权、模型/运行时分发、每 Key 下载额度及 HTTP 契约。
- 扩展保留远程与内置模型两种模式；内置版不得包含远程模型下载、Key 读取或远程模型 Host 权限。
- 源码、测试、清单、README 和 docs 共同定义契约，修改时同步核对。

## 开始工作前

1. 阅读本文件、[README](README.md)和任务相关文档；入口见[文档导航](docs/README.md)。
2. 检查 `git status --short --branch`，保留已有改动，不覆盖、清理或重置。
3. 有 `.codegraph/` 时，定位或理解代码先用 `codegraph_explore` / `codegraph explore`，再按需读取；没有索引则跳过，不自行建索引。
4. 做最小可验证修改，不混入无关重构、依赖升级或全仓格式化。
5. Key、Bearer、Cloudflare 凭据和受保护测试值不得进入源码、fixture、文档、日志、URL、提交信息或产物。

## 仓库结构与职责

| 路径                    | 职责                                                  |
| ----------------------- | ----------------------------------------------------- |
| `apps/userscript`       | 用户脚本入口、GM 桥接、构建与浏览器测试               |
| `apps/extension`        | 扩展入口、后台、推理 Host、设置、打包与浏览器测试     |
| `apps/model-worker`     | Worker、鉴权、R2 响应、Durable Object 额度与 Wrangler |
| `packages/browser-core` | 共用 DOM、答题、推理、模型下载、面板和平台接口        |
| `packages/shared`       | 纯模型、答案、令牌与 ORT 资产契约                     |
| `scripts`               | 门禁、文档漂移、包体、E2E 与发布辅助                  |
| `docs`                  | 使用、架构、参考、开发、决定、审计与领域专题          |
| `model` / `other`       | 固定本地模型输入 / Runtime 生成物；非默认源码入口     |
| `config`                | 被忽略的可再生本地配置，不重新跟踪                    |
| `.github/workflows`     | 仓库 CI 与 Worker 手动部署                            |

根脚本按 `checks/`、`ci/`、`docs-drift/`、`model/`、`ort-runtime/`、`e2e/`、`lib/` 分组；扩展脚本按 `build/`、`benchmark/`、`browser/`、`e2e/`、`model/`、`fixtures/`、`release/` 分组，不再平铺两级脚本根。文档测试在 `scripts/docs-drift/test/`；根与扩展 Node 测试均以带引号的 `scripts/**/*.test.mjs` 递归发现。目录联动见[目录组织](docs/development/directory-layout.md)。

## 依赖方向与模块边界

- `shared` 不依赖 DOM、GM、WebExtension 或 Cloudflare 运行时。
- `browser-core` 可依赖 `shared`；存储、网络和页面能力通过平台接口传入，不依赖应用实现。
- 用户脚本和扩展可依赖共用包，彼此不得导入源码；Worker 只依赖 `shared` 纯契约，不导入浏览器代码。
- 超时、面板、模型资产与协议常量由[权威模块](docs/architecture/overview.md#权威模块与变更入口)管理，不在调用方复制。
- 共用包保留显式 exports；新增公共子路径先确认调用者，不恢复通配导出或以深层相对路径绕过边界。
- 跨包导入或移动文件后运行 `architecture:check`。缺失受保护目录须失败关闭，反向类型依赖同样检查，包括 `import type`、`import('…').Type` 和 `typeof import('…')`。

## 浏览器端关键不变量

实现与时序见[浏览器运行时](docs/architecture/browser-runtime.md)、[扩展运行时](docs/architecture/extension-runtime.md)。

### 答案与提交

- 默认保留已勾选答案，区分手动与自动归属，绝不撤销手动项。每轮模型准备前开始跟踪人工变更；图片读取、推理、设置读取及点击等待中被手动取消的候选，本轮不得勾回，新轮次重建基线。
- 旧自动项可参与结果合并。合计不超过 4 项时保持；超过 4 项时只按置信度从低到高裁剪自动项，目标至多 3 项。手动项已达目标仍不得取消；提交等待后按实时选中和自动归属再次复核超量，每次初始/最终裁剪点击前重查归属。
- 关闭保留模式可清空并接管本轮答案，但提交前仍确认同一组有效表单、checkbox 与按钮。
- 控件数量、类型、连接、所属表单、有效禁用状态或提交按钮异常时停止。禁用检查覆盖 `fieldset` 继承和首个 `legend` 例外；外层 fieldset 禁用及 legend 顺序变化须进入即时取消/恢复复核，不点击失效或替换后的 DOM。
- 同一验证码的同类失败须冷却或去重，避免日志和面板无界重复。
- App 观察当前 documentElement，覆盖 body 替换与暂时缺失；验证码选择器的 `id/name` 补齐须补扫，移除时按旧活动目标即时取消。JPX 等脚本清除扫描 timer 后，相关 mutation 重挂扫描并保留原单调时钟截止时间，不因持续变化无限延期；销毁后迟到回调不得重启。
- 自动模式每题只作一次原生提交；取消、超时、路由或目标变化后旧轮次停止点击/提交。观察器先取消变化或移除的活动目标，再防抖扫描；旧初始化迟到结算不得阻塞新目标或覆盖状态。
- 目标快照从准备前包含解析后的表单 action、原生提交控件实际 action 和控件类型；准备、推理或设置读取时发生变化即令旧任务失效。`formaction` 不得绕过同源约束。
- 图片快照包含选源声明，`srcset`/`sizes`/`picture` 变化先取消旧轮次；响应式选源未就绪不回退旧图，加载完成补扫。设置读取须可取消且有界，未决 GM 读取不得阻塞新目标。

### 状态面板

- 默认 `top=155, left=1240`，默认仅存在 `div#csp` 时显示，允许关闭限制；隐藏不停止识别，显示和答题分别验证。
- 首次 body 暂缺时先观察并等待挂载，不中止 App 初始化；局部切页后挂回同一 StatusPanel 节点，保留状态、历史和异步写入身份。恢复独立于 csp 限制；渲染缓存命中或清理自身 mutation 前也复核挂载，destroy 阻止迟到复活。
- 历史总耗时从模型准备前起算，自动模式截至提交点击，手动模式截至结果记录；识别阶段单独统计。持续时间用同页单调时钟，显示时刻用本地时间；取消/过期目标不写完成状态。
- 状态、日志和历史有上限，重复错误聚合。新历史按每世界追加序号排序/裁剪，不由系统时间回拨决定新旧；旧记录不强迁移。保存失败回滚到已保存历史并报错。
- 异步历史裁剪只依据已提交快照，未决乐观写入不能挤掉已保存记录；快照不完整则跳过删除。用户脚本用同源 localStorage 独立键追加，有效旧根只读兼容，不恢复整根 JSON 读改写。每世界最多读取 50 条，稳定追加后裁剪；并发可暂时超出物理数量。
- 使用安全 DOM API；新增 `innerHTML`、动态代码等危险调用触发门禁，原则上不加白名单。

### 平台、存储与网络

- 用户脚本通过 GM 桥接特权 API；扩展内容脚本不得接收模型 Key 或字节。扩展 Key 只存扩展源 IndexedDB，普通设置/历史用 `storage.local`；不降级到页面存储、URL 或可回显控件。
- 客户端保存和发送 Key 保留验证过的原始大小写，只去除首尾空白；服务端额度身份规范化不变。下载脚本的配置校验与错误链不得回显 URL、Bearer 或受保护值。
- GM Key 新设置/清除先淘汰未写入的旧验证，不能让迟到验证恢复已清除或覆盖新 Key。实际提交后才取消并等待旧未完成初始化，再恢复当前失败目标；已就绪会话复用。取消输入、验证或存储失败不恢复，旧提交和销毁后回调不得唤醒旧 App。
- 扩展 Key 事务提交独立驱动共享 Host 的同类恢复，再通知内容页，不依赖原请求成功响应。调用方取消仍报告取消，不能声称撤销已提交变更；提交前回滚不通知，关闭后的 Host 不复活，已就绪会话可复用。
- 内容设置镜像按 key 合并初始化变更，限制超时、取消和不同 key 数量。快照失败清理监听器；预取消不读快照或监听。销毁后不启动排队写入/删除，已发起调用按真实结果结算。历史解析缓存观察外部写入并保留写后最终校对。
- 原生 `fetch` 通过已有解析辅助函数调用，保留接收者，避免 `Illegal invocation`。
- 消息严格校验 schema、来源、大小、超时和取消，`unknown` 不直接断言可信。Broker 只用实际 `sender.url`，不以 `sender.tab.url` 兜底；提供的 `sender.origin` 须一致且非 opaque，提供 `frameId` 时须为 0。内容仅限两个 Hentaiverse HTTPS 标准端口 origin，设置仅限本扩展设置页。
- Port 断连在回调内经平台助手同步读取 Chromium `runtime.lastError`，兼容 Firefox `port.error`。BFCache 断连取消未决请求，恢复后按需连接，不自动重放下载或 Key 操作。Offscreen 同一空闲代际的确认不重置关闭重试次数或退避预算，新活动/代际才恢复预算；新 epoch 接管已空闲文档须迁移剩余通知，取消后迟到创建也须独立有界 claim，不重放原请求。
- 图片消息有明确上限；HTTP Content-Type 严格校验后规范化基础 MIME，消息保持精确白名单。排队 detect 取消即移除并释放图片，不等队头。模型用可转移 `ArrayBuffer`，不改成无界 Base64 或重复拷贝。
- 识别遵循 latest-wins，迟到旧结果不覆盖新状态。图片、模型和 Runtime 共用有界字节读取；未知长度在上限内增长自有缓冲并即时复制，不保留任意分块或外部大缓冲视图。
- 浏览器和 Worker 流取消仅尽力清理，不等待可能挂起的取消 Promise，不覆盖原 HTTP、完整性或调用方取消错误。

## 模型、运行时与扩展产物

资产身份与更新见[Runtime](docs/onnx-runtime.md)，缓存事务见[缓存专题](docs/model-cache-strategy.md)，打包见[扩展专题](docs/browser-extension.md)。

- ORT 模型/WASM 的文件名、URL、对象键、长度和 SHA-256 是原子契约；替换时同步清单、Worker 配置、构建器、测试和文档。
- 模型 GET `403` 是永久 Key 拒绝，不作瞬时自动重试；提示不含 Key、URL 或正文，凭证提交后可走原恢复流程。内置资产确定性完整性失败跨 Worker 保留永久分类。
- 模型/WASM 拒绝重定向，校验最大、声明、实际长度及 SHA-256；失败内容不缓存。远程扩展完整读取、校验并成功写入 IndexedDB 后才确认下载。
- 模型字节与回执元数据在同一初始事务内绑定同一写入身份；确认后只更新匹配元数据，旧确认不覆盖新模型。
- 缓存关闭、IndexedDB `versionchange`/异常 `close`、取消和超时传播到确认请求；晚到结果不清回执或标记已确认，不能撤销服务端已处理的确认。异常关闭清除连接，下次操作重新打开；旧连接迟到事件不得关闭新连接。
- 内置构建只接受固定模型输入；产物审计模型身份、CSP、权限、Host、动态导入和远程可执行代码。JS、Worker、ORT glue、WASM 均随包分发，不允许远程执行。
- 完整审计 MV3 后台、设置、action、content 和 CSP，拒绝未授权可选权限、外部连接与 sandbox。HTML 包括嵌套 template，不含内联事件、可执行 URL、srcdoc 或 base 覆写。
- 远程包不含 `.ort`；内置包恰含清单声明的一个 `.ort`。不得声明 `web_accessible_resources` 或图片资源，必要变更须同步威胁模型、审计、测试和文档。
- ZIP 固定本地日历字段，不把 UTC 时间点交给按本地时间编码的归档器；相同输入跨时区字节与 SHA-256 一致。
- 包内按 `background/`、`content/`、`options/`、Chromium `offscreen/`、`runtime/` 分组，内置另有 `model/`，两份 JSON 清单在目标根。入口由 `apps/extension/src/platform/extension-paths.ts` 的 `EXTENSION_PATHS` 管理，变更同步清单、URL、来源、审计、浏览器脚本和文档。

## Model Worker 与额度规则

精确响应归[HTTP 契约](docs/reference/model-worker-http.md)，状态所有权归[服务架构](docs/architecture/model-service.md)。

- 模型 Key 只接受 `Authorization: Bearer <64 位十六进制值>`，查询字符串永不授权真实模型。统一规范化 Key，以不可逆摘要隔离 DO；不使用全局计数，不记录原 Key、规范化 Key、摘要或额度状态。
- 默认每 Key 每 UTC 自然月最多 5 次已确认下载，ONNX/ORT 共用。`GET /quota` 只查，模型 GET 只预留回执，成功缓存后 `POST /quota` 确认才计次。
- 开启额度时，模型 GET 在读 R2 前只读预检已确认额度；耗尽/预检失败不读对象。完整性检查后仍需原子预留，预检不替代并发/待确认槽位硬上限。
- 回执重复确认幂等；未知、失效或未完成回执不计次，并发不能突破月度上限。
- 关闭额度时显示未启用/无限制，不伪造有限剩余量。确认请求格式正确返回 `409`，缺失/畸形回执返回 `400`，不伪造成功。
- 模型、额度、公开 Runtime 各自维护 CORS 方法、头与公私策略，不合并成宽泛全局常量。HEAD、OPTIONS、诱饵和 Runtime 不计次；模型 `no-store`，内容寻址 Runtime 可长期 immutable。
- R2 缺失或完整性异常失败关闭，不回退其他对象。DO 绑定、类导出、迁移是持久状态契约，回滚不可删除。

## 编码与文档规范

- 严格 TypeScript/ESM，边界输入从 `unknown` 校验，避免无依据断言、`any` 和非空断言。命名表达领域，标准协议字段保持英文。
- ESLint 看根 `eslint.config.mjs`，Prettier 看根 `package.json#prettier` 和 `.prettierignore`；只格式化本次文件。
- 用户提示用清晰中文；注释说明原因、约束和安全边界。错误保留可诊断原因，不泄露 Key、内部标识或配置；区分断网、HTTP、解析、完整性和额度拒绝。
- 公开行为、命令、默认值、路由、头、资产或构建变化时，同步 README 摘要、所属专题、测试与 `scripts/docs-drift/` 事实提取/回归。
- 精确命令归 `docs/development/commands.md`，HTTP 归 `docs/reference/model-worker-http.md`，资产归 `docs/onnx-runtime.md`。迁移契约同步逐篇读取与负向测试，不拼接全部正文掩盖缺项。
- 非平凡行为、架构、跨文件契约、工具流程、测试策略或数据格式变化须更新已有决定或新增 `docs/decisions/<lifecycle>/<class>/日期-主题.md`。遵循 [write-notes-like-deepseek 格式约定](docs/development/documentation.md#决策笔记)，理由翻转另写互链；机械修改不立 Note。
- 笔记根及祖先、归档目录/Markdown/封印清单拒绝 symlink，不能经链接走出仓库后跳过 Git 基线。每条封印独立校验普通文件、归档相对路径和 SHA-256；扫描遗漏不替代验证，清单异常不追加封印；Git 仓库内直接入口也验证基线 commit，无效基线或读取失败不能冒充历史清单缺失。
- 新维护文档按[导航](docs/README.md)归类；目录迁移同步包命令、测试发现、CI 和引用。历史审计保留原日期与证据，不刷新旧测试结果。

## 配置与秘密

不提交 `.env`、凭据、KV/R2 标识、受保护 E2E 值或其日志，不强制跟踪 `config/`。`apps/model-worker/wrangler.template.toml` 是权威配置，生成的 `wrangler.toml` 不手工维护。

Actions 部署值通过受保护 secrets/variables 和手动输入传入；无生产凭据时不执行生产下载/部署。测试只用明确测试绑定或进程内 fixture，配置测试按白名单复制源码，不复制生成配置、环境文件或 `.wrangler/` 状态；真实 Key E2E 仅在受保护环境显式启用并 fail closed；Chromium 鉴权 smoke 拒绝非空 DEBUG/PWDEBUG，Key 输入异常不透传 call log、原异常或 cause。普通 CI、content E2E 和内置 E2E 不访问生产模型服务。

## 测试与验证

工具链由 `mise.toml` 固定 Node.js `24.15.0`、pnpm `12.11.2`，同步根包 Node `>=24.15.0` 与 `pnpm@12.11.2`。首次 `mise trust`、`mise install`、`mise exec -- pnpm install --frozen-lockfile`；优先用 `mise exec -- pnpm`，包脚本或已激活 shell 可直接用 pnpm。

先定向验证，再按风险扩大，例如 `mise exec -- pnpm --filter @hv-pony-solver/browser-core test`；完整矩阵见[验证手册](docs/development/verification.md)。包含 Worker 的测试/构建前，先在仓库外备份已有生成配置，渲染测试绑定，结束按字节恢复：

```bash
MODEL_KEYS_KV_NAMESPACE_ID=test-kv \
MODEL_BUCKET_NAME=test-bucket \
mise exec -- pnpm --filter @hv-pony-solver/model-worker render-config
```

提交前默认完整检查：

```bash
mise exec -- pnpm check
mise exec -- node scripts/ci/assert-pinned-actions.mjs
git diff --check
```

`check` 包含格式、lint、类型、工作区和根测试、文档、架构、危险调用、扩展打包、包体、覆盖率与构建。完整检查只跑一次工作区覆盖率测试及一次 `test:root`，不先运行 `check:quick` 重复普通测试；`check:quick` 仍使用普通测试。格式按忽略规则排除生成物、第三方资产与锁文件。`pnpm test` 先跑工作区再调用 `test:root`，后者以带引号的 `scripts/**/*.test.mjs` 发现根级用例；`pnpm -r test:coverage` 不含根级测试，单独运行不能替代前者或证明 CI test job 通过。

测试按所有权去重：共用行为归 browser-core，应用保留适配接线与平台特有回归。删除用例须指出保留的等价行为断言；安全边界、取消/并发时序、已修缺陷和真实产物验证不能用行覆盖率替代，不降低门槛或以 skip/todo、缩窄 include 隐藏测试。具体取舍见[验证手册](docs/development/verification.md#测试归属与精简)。

- 修改用户脚本 Runtime 后分别检查 default/bundled 包体，不互相替代。
- 修改扩展构建、安全或协议后，至少运行相关构建/E2E；远程/内置、Chromium/Firefox、最低版本/Android 各自提供证据。load-only 不证明真实模型鉴权。
- 纯文档至少执行以下命令；vendor Runtime README 另按[维护规则](docs/development/documentation.md#验证文档修改)检查：

```bash
mise exec -- pnpm format:check
mise exec -- pnpm docs:check
mise exec -- node --test "scripts/docs-drift/test/*.test.mjs"
git diff --check
```

环境缺能力时明确未运行项、原因与替代验证，不声称全部通过。

## GitHub Actions 与部署

仅维护 `.github/workflows/verify-monorepo.yml`（Repository CI）和 `.github/workflows/deploy-cloudflare-model-worker.yml`（手动部署）。两者用 `jdx/mise-action` 读根工具链，保留 pnpm store 缓存/冻结安装；仅需 Node 的发布步骤可只装 node。

- Actions 固定完整 40 位 commit SHA，Docker 固定完整 `sha256`，由 `assert-pinned-actions.mjs` 校验。同行 flow 中每个 `uses` 都检查，quoted 键值先解码；纯标量不当配置，不能可靠识别的相关语法拒绝，checkout 凭据字段不借用相邻步骤或字符串。
- CI 修改核对真实 job 命令，不漏根 Node 测试；合并 job/workflow 保留最小权限、条件、发布门禁及 Code Scanning 连续性。
- 扩展 artifact/Release 显式依赖本次 `codeql` 成功。完整 ZIP 的首次上传（含 job 间传递）也须通过发布授权及全部所需门禁；Android 校验在 canonical 构建 job 内对本地同一 ZIP 完成。分析成功不等于无告警；修复后核对新分析及告警实例。
- Worker 默认不部署，仅明确允许发布的手动输入且 secrets 完整时部署。额度开关属于部署配置，无限制时客户端显示未启用。

| 手动输入                      | 授权产物与门禁                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| `publish_userscript_artifact` | 只上传用户脚本 Actions artifact，不创建 Release                                                         |
| `publish_extension_release`   | 仅 main 创建 `extension-v<扩展版本>`，含远程桌面双浏览器 ZIP、校验与元数据；非商店发布/Android 验证     |
| `publish_extension_artifact`  | 内置模型 artifact，须 canonical、桌面双浏览器、受保护远程模型和同一 Firefox ZIP 的 Android 142 外部证据 |

发布输入默认关闭。普通 push/PR 或未勾选输入的手动运行不创建 Release、不发布生产 artifact。详细门禁见[CI 与发布](docs/development/releases.md)。

## Git 与交付纪律

- 不用 `git reset --hard`、`git checkout --` 等清理用户改动。递归构建/安装清理拒绝仓库、cwd、home 及其祖先，临时目录也不例外。
- ORT 构建持有已验证根目录的只读描述符锁，不跟随或截断遗留 `.build.lock`；加锁后仍核对构建根身份。
- 提交前检查 status、diff、cached diff 和 `git diff --check`，仅包含本任务文件；不提交 dist、coverage、生成配置、下载模型、浏览器配置、临时证据或秘密。大模型不随意纳入 Git。
- commit 概括具体行为。仅用户明确要求才 commit、push、发布 artifact 或部署；push 前整合远程新提交。
- 要求远程 CI/安全复核时，等待对应 commit 检查结束再报告，已触发不等于通过。

## 本文件的维护

目录/工作区/workflow、依赖方向、关键不变量、工具链/验证/发布或本文事实变化时，同批更新本文件及相关专题。以源码、测试和工作流为准，保留强约束，详细操作链接到权威文档；至少执行 Markdown 格式、`git diff --check` 和受影响的文档漂移测试。
