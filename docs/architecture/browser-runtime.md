# 浏览器运行时架构维护指南

本文是 `packages/browser-core` 与 `apps/userscript` 的维护者导航。它说明共享核心、用户脚本平台适配、验证码生命周期、模型缓存、推理 Worker、状态面板和测试之间的边界。行为契约以源码、测试和共享包为准；本文只描述关系和维护入口，不复制模型、Runtime 或依赖的版本、长度和哈希等易漂移数据。

相关专题：

- [模型缓存与计次策略](../model-cache-strategy.md)：模型来源、缓存确认、额度和失败关闭规则。
- [精简 ONNX Runtime Web](../onnx-runtime.md)：用户脚本的外置/内置 Runtime profile 与资产校验流程。
- [扩展架构](../browser-extension.md)：扩展如何复用本页描述的核心接口，并在另一种平台上提供实现。
- [共享契约](../../packages/shared/src/index.ts)：答案码、模型和协议类型的权威入口。

## 维护范围与分层

浏览器运行时分成两层：

1. `packages/browser-core/src` 保存与宿主平台无关的浏览器业务核心。它可以使用 DOM、Worker、IndexedDB 和 Fetch 的标准接口，但不读取 GM API、扩展 API 或用户脚本全局变量。外部能力通过接口、构造函数参数或 Worker 工厂注入。
2. `apps/userscript/src` 保存用户脚本入口和平台实现。它把 GM 存储、菜单、用户脚本构建产物和 Blob Worker 接到核心接口上，并为外置/内置 Runtime 提供不同 Worker 入口。

包边界由 [browser-core/package.json](../../packages/browser-core/package.json) 的显式 exports 和根级架构检查共同约束。共享核心只能依赖 [shared](../../packages/shared/src/index.ts) 的纯契约；用户脚本依赖核心和 shared，不应把用户脚本实现反向导入核心。新增跨包导入、移动模块或改变导出时，运行 `architecture:check` 并检查对应测试。

核心包的根入口适合跨领域应用组装；领域子路径只公开已盘点的稳定模块。修改导出表时，同时用真实 workspace 消费者执行 TypeScript 类型检查和 Node 的 `import.meta.resolve` 解析验证，避免 TypeScript `paths` 或 bundler alias 掩盖缺失的 package export。

## 目录导航

目录已经按领域分组，新增源码应继续放入已有领域目录，避免把大量文件堆在 `src` 根目录。`index.ts` 是公开聚合入口，不是新业务代码的放置位置。

| 目录                                               | 所有者        | 主要职责                                                      | 首要测试目录                              |
| -------------------------------------------------- | ------------- | ------------------------------------------------------------- | ----------------------------------------- |
| `packages/browser-core/src/app`                    | 核心          | 页面观察、调度、生命周期、取消                                | `packages/browser-core/test/app`          |
| `packages/browser-core/src/captcha`                | 核心          | 目标定位、图片读取、答案选择、提交和设置契约                  | `packages/browser-core/test/captcha`      |
| `packages/browser-core/src/inference`              | 核心          | 图像预处理、Worker 协议、推理客户端和输出解析                 | `packages/browser-core/test/inference`    |
| `packages/browser-core/src/model`                  | 核心          | 模型下载、完整性、IndexedDB 缓存和下载确认                    | `packages/browser-core/test/model`        |
| `packages/browser-core/src/persistence`            | 核心          | 历史校验、限额、排序、旧根键与 keyed 记录兼容读取及损坏值清理 | `packages/browser-core/test/persistence`  |
| `packages/browser-core/src/platform`               | 核心接口/原语 | 存储、Fetch、字节流等可注入平台能力                           | `packages/browser-core/test/platform`     |
| `packages/browser-core/src/status-panel`           | 核心          | 状态、历史和安全 DOM 渲染                                     | `packages/browser-core/test/status-panel` |
| `packages/browser-core/src/utils`                  | 核心          | 取消竞态、延迟、错误格式化、日志和类型守卫                    | `packages/browser-core/test/utils`        |
| `apps/userscript/src/app`                          | 用户脚本适配  | 组装核心服务和入口 App                                        | `apps/userscript/test/app`                |
| `apps/userscript/src/userscript`                   | 用户脚本平台  | GM 桥接、敏感存储、菜单和 metadata                            | `apps/userscript/test/userscript`         |
| `apps/userscript/src/inference`                    | 用户脚本适配  | Blob Worker、Runtime profile 和核心 Worker 的装配             | `apps/userscript/test/inference`          |
| `apps/userscript/src/model`                        | 用户脚本适配  | 用 GM Key 和用户脚本 Fetch 组装核心模型服务                   | `apps/userscript/test/model`              |
| `apps/userscript/src/status-panel` / `persistence` | 用户脚本适配  | 注入 GM 设置存储和历史存储                                    | 对应同名测试目录                          |
| `apps/userscript/scripts`                          | 构建/资产门禁 | esbuild 构建、metadata 注入、Runtime/模型验证                 | 脚本旁的 `*.test.mjs`                     |

公开聚合导出见 [browser-core/src/index.ts](../../packages/browser-core/src/index.ts)，深层入口以 [browser-core/package.json](../../packages/browser-core/package.json) 的显式 exports 为准。需要平台专用实现时，应优先新增用户脚本目录中的薄适配器，避免在聚合入口加入宿主判断。

## 组装路径

用户脚本从 [main.ts](../../apps/userscript/src/main.ts) 开始：页面仍在加载时等待 `DOMContentLoaded`，否则立即初始化；非 BFCache 的 `pagehide` 调用销毁。入口 App 继承核心 [App](../../packages/browser-core/src/app/app.ts)，只负责把 `createAppDependencies` 组装的信号所有者接回核心。

依赖组装位于 [apps/userscript/src/app/app-dependencies.ts](../../apps/userscript/src/app/app-dependencies.ts)：

```text
App
 ├─ StatusPanel(HistoryStore, gmSettingsStorage)
 ├─ ModelCache(用户脚本 downloadModel)
 ├─ OnnxWorkerClient(Blob Worker factory)
 ├─ CachedImageLoader
 ├─ AnswerSubmitter(设置存储提供的延迟)
 └─ CaptchaSolver(panel, detector, imageLoader, submitter, answer mode, abort signal)
```

核心服务只依赖接口。例如 [AppDependencies](../../packages/browser-core/src/app/app-dependencies.ts)、[DetectorService](../../packages/browser-core/src/inference/inference-types.ts)、[StatusPanel contract](../../packages/browser-core/src/status-panel/status-panel-types.ts) 和 [SettingsStorage](../../packages/browser-core/src/platform/storage.ts) 定义了核心与平台的接缝。维护时先确认接口属于哪一层，再决定修改核心行为还是平台适配。

## 验证码生命周期与取消

[core App](../../packages/browser-core/src/app/app.ts) 观察页面上验证码目标相关的 DOM 变化，使用启动延迟和 MutationObserver 防抖调度扫描。它保存当前、失败和准备中的目标，并在销毁、页面切换、Key 变化时推进取消信号或凭据修订号。

一次自动处理的主链路是：

```mermaid
sequenceDiagram
    participant DOM
    participant App
    participant Solver as CaptchaSolver
    participant Image as ImageLoader
    participant Detector as OnnxWorkerClient
    participant Submit as AnswerSubmitter
    participant Panel as StatusPanel
    DOM->>App: 验证码出现或变化
    App->>Detector: prepare(signal)
    Detector-->>App: Worker 会话就绪
    App->>Solver: trigger(target)
    Solver->>Image: get(captchaKey, signal)
    Image-->>Solver: Blob
    Solver->>Detector: detect(blob, signal)
    Detector-->>Solver: 结构化 YOLO 结果
    Solver->>Submit: submit(form, answers, isCurrent)
    Submit->>DOM: 校验控件、勾选、延迟后原生提交
    Solver->>Panel: 状态与历史
```

`CaptchaTarget` 在捕获时保存解析后的 `form.action`，`App` 与 `CaptchaSolver` 在准备、图片、推理和提交阶段通过 `isSameCaptchaTarget` 复核该地址及控件身份。地址变化会使旧任务失效；相对与绝对写法解析到同一 URL 时仍是同一目标。取消、超时或新目标到达后，旧任务不能继续点击或提交。答案提交器在开始和等待后再次确认表单 action、checkbox 数量、节点身份、所属表单、连接状态和禁用状态；相关约束集中在 [answer-submitter.ts](../../packages/browser-core/src/captcha/answer-submitter.ts)。

保留答案时，程序自动勾选和用户手动勾选通过 WeakMap 与 change 监听区分；超过上限时只按置信度移除自动项。手动模式只记录识别结果，不自动提交。随机兜底由 [CaptchaSolver](../../packages/browser-core/src/captcha/captcha-solver.ts) 的配置控制，修改时必须同时检查提交测试和 App 级取消测试。

多选等待期间，用户可能先于程序勾选下一项。提交器只为本轮实际点击成功的项或原本带自动标记的项更新置信度，不能因为答案出现在识别候选中就接管手动项。后续同一表单的识别与合并仍须保留这项手动身份。

## 推理 Worker 与 Runtime profile

核心 [onnx-worker-client.ts](../../packages/browser-core/src/inference/onnx-worker-client.ts) 管理 Worker 的创建、初始化共享、检测串行队列、超时恢复、失败会话重建和销毁。它不决定 Worker 如何创建；`WorkerFactory` 由平台注入。

核心 [onnx-worker-entry.ts](../../packages/browser-core/src/inference/onnx-worker-entry.ts) 执行 Worker 内部协议：严格验证 `unknown` 请求、初始化 Runtime、创建可复用的 OffscreenCanvas/CHW 缓冲、执行 WASM 推理、解析输出并回传结构化消息。[worker-request-bridge.ts](../../packages/browser-core/src/inference/worker-request-bridge.ts) 在主线程验证响应、管理 request id 和超时。

用户脚本的 [onnx-worker-client.ts](../../apps/userscript/src/inference/onnx-worker-client.ts) 注入 [blob-worker.ts](../../apps/userscript/src/inference/blob-worker.ts) 创建的 Worker，并把构建时内联的脚本文本交给它。两个入口分别是：

- [onnx-worker-external-entry.ts](../../apps/userscript/src/inference/onnx-worker-external-entry.ts)：有界下载、校验外置 Runtime JS/WASM，校验成功后才通过 `importScripts`，并限制启动排队请求数。
- [onnx-worker-bundled-entry.ts](../../apps/userscript/src/inference/onnx-worker-bundled-entry.ts)：使用构建时提供的 Runtime glue，再通过 [runtime-wasm-loader.ts](../../apps/userscript/src/inference/runtime-wasm-loader.ts) 校验 Runtime WASM。

构建脚本 [build-userscript.mjs](../../apps/userscript/scripts/build-userscript.mjs) 选择 profile、把 Worker bundle 内嵌到主脚本、从 metadata 模板注入包版本，并可输出构建清单。资产身份和 profile 约束以 [onnx-runtime-assets.mjs](../../apps/userscript/scripts/onnx-runtime-assets.mjs) 与 [docs/onnx-runtime.md](../onnx-runtime.md) 为准，本文不重复具体数值。

## 模型下载、缓存和存储

核心 [model-downloader.ts](../../packages/browser-core/src/model/model-downloader.ts) 负责请求初始化、Bearer Key、重定向拒绝、响应状态、流式有界读取、完整性验证和下载确认回执。用户脚本 [model-downloader.ts](../../apps/userscript/src/model/model-downloader.ts) 只增加用户脚本 Key 来源和调用者/超时 AbortSignal 的组合，实际协议仍由核心负责。

[ModelCache](../../packages/browser-core/src/model/model-cache.ts) 编排缓存读取、共享下载、写入和确认；[indexeddb-model-store.ts](../../packages/browser-core/src/model/indexeddb-model-store.ts) 管理事务和生命周期；[model-cache-record.ts](../../packages/browser-core/src/model/model-cache-record.ts) 校验记录；[shared-model-downloads.ts](../../packages/browser-core/src/model/shared-model-downloads.ts) 合并同一时刻的网络下载。对带下载确认回执的远程模型，内容与待确认元数据先在同一事务落盘；确认成功并将匹配元数据改为已确认后，后续读取才允许命中。没有确认回执的路径不会额外发送确认请求。关闭或 `versionchange` 必须取消数据库操作和共享下载。

用户脚本模型 Key 走 [model-settings.ts](../../apps/userscript/src/model/model-settings.ts) 与 [sensitiveGmSettingsStorage](../../apps/userscript/src/userscript/gm-storage.ts)。普通设置使用 `gmSettingsStorage`；Key 使用敏感存储，GM API 不可用时拒绝写入页面可读的 localStorage。历史由 [answer-history-store.ts](../../apps/userscript/src/persistence/answer-history-store.ts) 注入 `userscriptHistoryStorage`，按前缀无缓存枚举同源 localStorage，复用核心 HistoryStore 的独立键追加、校验与排序。枚举先取得 key 快照，再跳过已被其他标签删除的值；有效旧根键只读保留，不再用整份 JSON 读改写新增历史。读取最多返回每世界 50 条，独立键在稳定追加后裁剪到 50；并发期间可暂时多存，旧根兼容数据也可能继续保留在底层。

缓存策略、`GET /quota`、`POST /quota`、确认时机和 `no-store` 约束请只在[模型缓存专题](../model-cache-strategy.md)维护。不要在平台适配器中复制额度或缓存状态机。

## 状态面板与历史

核心 [status-panel.ts](../../packages/browser-core/src/status-panel/status-panel.ts) 管理生命周期、状态、历史突变代次、异步设置回写和 CSP 可见性观察；[status-panel-renderer.ts](../../packages/browser-core/src/status-panel/status-panel-renderer.ts) 使用安全 DOM API 渲染，不应新增 `innerHTML` 或动态代码执行。历史条数由设置约束；持久化期间先显示乐观结果，保存失败后回滚到已保存历史并显示错误，未保存条目不会继续留在面板。

[HistoryStore](../../packages/browser-core/src/persistence/answer-history-store.ts) 为新记录分配每世界独立的 `sequence` 正安全整数，取本实例已分配序号与当前可见记录序号的最大值加一。分配发生在异步写入前，失败允许留下序号空洞；重建实例后从已保存记录恢复顺序。独立键历史按序号、时间戳和稳定 key 排序后裁剪；旧记录缺少序号时仍按原时间戳规则读取，非枚举存储的旧数组继续保持原顺序。显示用的 `timestamp`/`time` 不做单调化，也不重写旧数据。尚未互相观察到的并发写可使用同一序号，再按时间戳和 key 确定顺序；之后看到这些写入的新记录会取得更大序号。非法序号按损坏记录处理，安全整数上限耗尽则通过保存失败通道报告，不写入溢出值。

App 每轮在 `prepareTarget()` 前捕获当前页面的 `performance.now()`，经 `SolverService.trigger(target, startedAt)` 传给 Solver。新历史的 `elapsed` 计入准备与重试，自动模式截至原生提交点击，手动模式截至记录结果；开始扫描前的加载、防抖和提交后的网络响应不计入。Solver 独立统计图片获取和识别请求耗时，并在目标仍有效时统一写入“完成 Nms”，供用户脚本与扩展共用。持续时间按整数毫秒记录，历史时刻仍由 `Date.now()` 生成；旧历史不重新计算。修改时应覆盖准备重试、系统校时、新目标重置、取消和 DOM 替换。

用户脚本 [status-panel.ts](../../apps/userscript/src/status-panel/status-panel.ts) 只把 HistoryStore 和 GM 设置存储传给核心。修改面板默认位置、显示条件、紧凑模式或历史上限时，同时检查 [panel-settings.ts](../../packages/browser-core/src/status-panel/panel-settings.ts)、用户脚本对应设置文件、核心/用户脚本面板测试和 README/专题文档。

## 测试地图与验证边界

核心和用户脚本测试目录按源码领域镜像组织。核心 `vitest` 默认使用 jsdom；用户脚本 `vitest` 也使用 jsdom，脚本门禁另由 Node test 执行。用户脚本唯一的 Playwright 浏览器目录是 `test/e2e`，当前配置只声明 Chromium 项目；这不能证明 Firefox、不同用户脚本管理器或真实 Model Worker 的行为。

| 变更                     | 最小测试                                                                                   | 还应关注                                          |
| ------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| App 调度、目标替换、销毁 | `browser-core/test/app`, `userscript/test/app`                                             | `CaptchaSolver`、E2E smoke                        |
| 勾选、保留答案、原生提交 | 两个包的 `test/captcha/answer-submitter.test.ts`                                           | 表单替换和取消场景                                |
| Worker 协议、超时、恢复  | 两个包的 `test/inference`                                                                  | 用户脚本 Blob Worker 与两个 Runtime 入口          |
| 下载、完整性、缓存事务   | `browser-core/test/model`、`userscript/test/model`                                         | `docs/model-cache-strategy.md`、Model Worker 契约 |
| GM 存储和设置菜单        | `userscript/test/userscript`                                                               | 敏感 Key 不落到 page-readable storage             |
| 面板和历史               | 两个包的 `test/status-panel` 与 `test/persistence`                                         | CSP 可见性、异步设置和持久化失败                  |
| 构建/metadata/资产       | `apps/userscript/scripts/*test.mjs`、`apps/userscript/test/userscript-build-smoke.test.ts` | 构建产物审计和包体预算                            |

常用验证命令：

```bash
mise exec -- pnpm --filter @hv-pony-solver/browser-core test
mise exec -- pnpm --filter @hv-pony-solver/userscript test
mise exec -- pnpm --filter @hv-pony-solver/browser-core typecheck
mise exec -- pnpm --filter @hv-pony-solver/userscript typecheck
mise exec -- pnpm docs:check
```

上述测试主要证明模拟 DOM、Worker、Fetch、存储和构建门禁；它们不自动证明真实页面、真实 GM 管理器、真实远程模型鉴权或浏览器多引擎兼容性。涉及这些边界时，在报告中单独列出已运行的 E2E 和未覆盖项。

## 风格、注释和模块化维护规则

- TypeScript 使用严格类型、ESM 和 `unknown` 入站校验。跨 Worker、Fetch、存储和设置边界先做结构检查，再转换为领域类型。
- 注释解释生命周期、取消、完整性、事务和安全边界等“为什么”；不要给显而易见的逐行代码添加注释。已有关键注释主要位于缓存事务、Worker 恢复、取消竞态和敏感 GM 存储处，修改这些代码时应同步更新原因说明。
- 中文用户提示与错误保留在面向用户的适配层或领域模块；协议字段、HTTP 头和标准 API 名称保留英文。
- 目录继续按 `app`、`captcha`、`inference`、`model`、`persistence`、`platform`、`status-panel`、`utils` 分组。若一个领域出现多个独立子流程，优先在该领域下增加语义子目录并同步测试目录；不要为了减少文件数量把无关职责合并进大文件。
- 当前较大的协调模块包括核心 `inference/onnx-worker-client.ts`、`model/model-downloader.ts`、`captcha/answer-submitter.ts`、`app/app.ts` 和 `status-panel/status-panel.ts`。拆分前先为公共行为保留测试，再按边界提取纯函数或状态对象；不要把平台判断散落到核心。
- 用户脚本中的薄包装器是有意的依赖注入边界。只有当包装器重复了业务逻辑，或核心接口无法表达平台差异时，才考虑调整；不要仅为减少文件数删除它们。
- 修改公开默认值、协议、构建 profile、资产路径或存储键时，检查 README、相关专题、测试和文档漂移门禁。易漂移常量应继续由权威模块导出，文档链接到该模块或专题，不要复制第二份数值。

带日期的现状评估与优化优先级见[仓库审计](../audits/2026-09-07-repository-audit.md)，后续目录迁移按[目录方案](../development/directory-layout.md)分批验证。
