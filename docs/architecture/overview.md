# 整体架构与职责边界

三个应用和两个内部包共同实现浏览器本地识别。Cloudflare 只负责模型授权与分发，不接收验证码图片或识别结果。

## 名称与责任

| 名称          | 所在环境                          | 职责                                              |
| ------------- | --------------------------------- | ------------------------------------------------- |
| 推理 Worker   | 浏览器 Web Worker                 | 图像预处理、ONNX 会话、推理和输出解析             |
| 扩展推理 Host | Chromium Offscreen / Firefox 后台 | 模型与会话管理、Worker 生命周期、远程模式秘密存储 |
| Model Worker  | Cloudflare                        | KV 鉴权、R2 分发、Durable Object 额度             |

`bundled` 指用户脚本的 Runtime 构建，`packaged` 指扩展的模型交付；两者不是同一种离线能力。安装选择见[产品入口](../../README.md)，开发命令见[命令参考](../development/commands.md)。

## 依赖关系

```mermaid
flowchart TD
    US[apps/userscript] --> Core[packages/browser-core]
    Extension[apps/extension] --> Core
    US --> Shared[packages/shared]
    Extension --> Shared
    Core --> Shared
    Service[apps/model-worker] --> Shared
```

箭头表示允许的源码依赖。构建脚本可读取其他应用的资产和清单，例如扩展复用用户脚本的定制 Runtime；这不授权应用间导入业务源码。

| 单元           | 负责                                                            | 能力从哪里来                                      | 不应承担                             |
| -------------- | --------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------ |
| `shared`       | 答案码、Key 格式、模型与 WASM 身份、额度协议常量                | 纯 TypeScript 数据和函数                          | DOM、网络、存储及任何平台实现        |
| `browser-core` | 页面调度、目标身份、勾选提交、推理、模型缓存、面板与历史        | 平台接口、工厂、可注入 Fetch/存储；标准浏览器 API | GM 或 WebExtension API、平台入口选择 |
| `userscript`   | 用户脚本启动、GM 能力、设置菜单、Blob Worker 和 Runtime profile | 用户脚本管理器及浏览器                            | 扩展后台和 Cloudflare 绑定           |
| `extension`    | 内容脚本、消息、后台/Offscreen、设置页、远程/内置 Host 和打包   | WebExtension API、扩展源存储、包内资产            | 向内容脚本提供模型 Key 或模型二进制  |
| `model-worker` | Bearer/KV 鉴权、R2 响应、每 Key 下载额度和 CORS                 | Cloudflare KV、R2、Durable Object                 | 图片识别、答案选择或浏览器状态       |

内部包只提供根入口与显式子路径；新文件不会自动公开，移动公共源码需核对调用方。规则见[共享包导出边界](../development/directory-layout.md#共享包导出边界)。

## 运行链路

页面入口创建核心 App，依次调度目标定位、图片读取、Detector 推理和答案提交；每次操作复核目标与控件，过期任务不能继续点击。面板状态与历史有上限，可见性不影响识别。平台负责组装 Detector 与存储：

| 平台/模式         | 推理承载位置            | 模型来源                        | Runtime 来源                   | 设置与 Key                                        |
| ----------------- | ----------------------- | ------------------------------- | ------------------------------ | ------------------------------------------------- |
| 用户脚本 external | Blob Web Worker         | 模型服务；浏览器 IndexedDB 缓存 | 校验后的固定外置 JS/WASM       | GM 普通设置与敏感 Key 适配                        |
| 用户脚本 bundled  | Blob Web Worker         | 同上                            | 内置 glue；首方下载并校验 WASM | 同上                                              |
| 扩展 remote       | Host 创建 module Worker | 模型服务；扩展源 IndexedDB 缓存 | 扩展包内 JS/WASM               | 普通设置 `storage.local`；Key 独立 IndexedDB      |
| 扩展 packaged     | Host 创建 module Worker | 包内固定模型                    | 扩展包内 JS/WASM               | 普通设置 `storage.local`；不构建 Key/远程下载能力 |

Chromium Host 在 Offscreen Document 中运行，Firefox Host 由 background script 持有。

## 数据边界与所有权

扩展图片在浏览器上下文间以有上限的 Base64 适配 JSON 消息；模型在 Host 与 Worker 间使用可转移 `ArrayBuffer`。分别核对消息大小与缓冲区所有权，不把图片传输方式套用到模型。

模型 GET 只预留回执；客户端校验实际字节并提交缓存事务后才确认下载。二进制与确认元数据绑定同一次写入，迟到确认不能覆盖新模型。完整流程见[模型缓存](../model-cache-strategy.md)与[服务端状态机](model-service.md#额度-durable-objectreserveconfirm-与-ttl-清理状态)。

日志和广播只携带必要的非敏感状态，不包含 Key、内部对象身份或模型数据。远程/内置能力隔离同时受组装与产物审计约束。

## 权威模块与变更入口

| 要改变的契约             | 源码/配置入口                                                                                                                                                                            | 必须联动核对                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 客户端版本与构建命令     | [用户脚本包](../../apps/userscript/package.json)、[扩展包](../../apps/extension/package.json)                                                                                            | metadata、ZIP/清单、README、发布门禁           |
| Node/pnpm 版本           | [mise.toml](../../mise.toml)、[根 package.json](../../package.json)                                                                                                                      | CI、版本契约测试、环境说明                     |
| 工作区依赖和公开子路径   | [browser-core 包](../../packages/browser-core/package.json)、[shared 包](../../packages/shared/package.json)                                                                             | 所有调用方、TS 配置、架构检查                  |
| 图片尺寸、解析和推理超时 | [inference-config.ts](../../packages/browser-core/src/inference/inference-config.ts)                                                                                                     | 预处理、Worker、扩展截止时间、测试             |
| 消息对象与字段集合       | [guards.ts](../../packages/browser-core/src/utils/guards.ts)                                                                                                                             | Worker、推理结果与扩展协议的领域校验           |
| 答案保留和提交安全       | [answer-submitter.ts](../../packages/browser-core/src/captcha/answer-submitter.ts)                                                                                                       | 设置、Solver、表单替换/取消测试                |
| 面板默认值与可见性       | [panel-settings.ts](../../packages/browser-core/src/status-panel/panel-settings.ts)                                                                                                      | 两个平台设置、面板测试、README                 |
| 历史记录格式与持久化     | [answer-history-store.ts](../../packages/browser-core/src/persistence/answer-history-store.ts)                                                                                           | 两个平台存储、外部写入、历史上限               |
| 模型和 WASM 身份         | [shared 入口](../../packages/shared/src/index.ts)、[Runtime 清单](../../apps/userscript/src/inference/onnx-runtime-assets.ts)                                                            | 构建器、客户端下载器、Worker 模板、资产与专题  |
| 缓存事务和确认           | [model-cache.ts](../../packages/browser-core/src/model/model-cache.ts)、[IndexedDB store](../../packages/browser-core/src/model/indexeddb-model-store.ts)                                | quota 协议、并发写入、取消和元数据测试         |
| 扩展消息与截止时间       | [protocol facade](../../apps/extension/src/protocol/messages.ts)、[protocol modules](../../apps/extension/src/protocol/)、[deadlines.ts](../../apps/extension/src/protocol/deadlines.ts) | content、options、Broker、Offscreen、Host、E2E |
| HTTP 路由与响应头        | [request-router.ts](../../apps/model-worker/src/request-router.ts)、[model-response.ts](../../apps/model-worker/src/model-response.ts)                                                   | Worker 测试、客户端、README、漂移检查、运维    |
| 下载额度持久状态         | [model-download-quota.ts](../../apps/model-worker/src/model-download-quota.ts)                                                                                                           | 状态迁移、幂等、TTL、UTC 月边界、回滚契约      |
| 部署绑定与迁移           | [wrangler.template.toml](../../apps/model-worker/wrangler.template.toml)                                                                                                                 | 渲染器、DO 类导出、工作流与运维                |

## 扩展一个功能的落点

平台通用识别行为放核心领域目录，平台 API 放对应应用适配层，纯协议常量才进入 `shared`。公共设置需核对核心默认值、两平台入口和内容镜像；模型变化需核对清单、校验、打包、服务配置及发布证据。

详细流程见[浏览器运行时](browser-runtime.md)、[扩展运行时](extension-runtime.md)、[Model Worker](model-service.md)，验证命令见[开发与验证](../development/verification.md)。

## 自动约束与评审边界

`architecture:check` 保护显式 package exports、禁止方向和反向类型依赖；`inferenceTimeoutConfig` 集中维护异步期限，`StatusPanel` 负责 UI 状态输出，Model Worker Core 与浏览器应用隔离。缺失受保护目录时失败关闭，深层相对路径或 `typeof import()` 不构成例外。

静态检查不证明跨上下文时序；评审仍需核对所有权、取消、事务完成点与[浏览器证据](../development/verification.md)。精确 HTTP 头和资产值分别维护在[接口参考](../reference/model-worker-http.md)与[Runtime 专题](../onnx-runtime.md)。
