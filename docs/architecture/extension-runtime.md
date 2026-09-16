# 扩展上下文与生命周期

本文面向消息、后台、Key 事务、设置镜像与 Host 的维护者。构建模式、权限、产物和验收见[扩展产品手册](../browser-extension.md)，共享 DOM/答案流程见[浏览器核心](browser-runtime.md)。

## 模块导航

| 目录                 | 责任                                                 | 主要入口                                                                                                                                              |
| -------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/content/`       | 页面 DOM、内容 Port、设置镜像、预热                  | `main.ts`, `remote-detector-client.ts`                                                                                                                |
| `src/background/`    | Broker、浏览器后台生命周期、Chromium Offscreen 准入  | `chromium-bootstrap.ts`, `firefox-bootstrap.ts`, `broker.ts`                                                                                          |
| `src/offscreen/`     | Chromium 长寿命 Host 中转、epoch、取消和空闲回收     | `offscreen-bootstrap.ts`                                                                                                                              |
| `src/host/`          | 推理 Host、远程/内置模型、Key 存储、资产校验、状态   | `inference-host.ts`, `remote-inference-host.ts`, `packaged-inference-host.ts`                                                                         |
| `src/protocol/`      | 协议类型、运行时 guard、图片载荷、截止时间和请求结算 | `messages.ts`, `port-messages.ts`, `offscreen-messages.ts`, `image-payload.ts`                                                                        |
| `src/platform/`      | `browser`/`chrome` API 的最小适配层                  | `webextension-api.ts`, `webextension-runtime.ts`, `webextension-storage.ts`                                                                           |
| `src/options/`       | 普通设置和远程/内置模式设置页                        | `ordinary-settings.ts`, `remote.ts`, `packaged.ts`                                                                                                    |
| `scripts/build/`     | 目标构建、资产、策略、清单审计、归档                 | `build-extension.mjs`, `target.mjs`, `inventory.mjs`, `policy.mjs`, `archive.mjs`                                                                     |
| `scripts/benchmark/` | 基准参数、统计、结果校验、比较、CSV 和产品/runner    | `benchmark-contract.mjs`, `benchmark-config.mjs`, `benchmark-statistics.mjs`, `benchmark-result.mjs`, `benchmark-comparison.mjs`, `benchmark-csv.mjs` |
| `scripts/`           | 浏览器、E2E、模型下载、发布门禁                      | 按 `build/benchmark/browser/e2e/fixtures/model/release` 分组                                                                                          |
| `test/`              | 与源码目录对应的单元、协议、构建和平台 fixture       | `test/<area>/*.test.ts`                                                                                                                               |

平台适配层只暴露最小的运行时、存储、Offscreen 和 action 能力。业务模块不要直接读取 `globalThis.browser`/`chrome`，协议边界也不要绕过 `unknown` guard。

## 一次识别请求的生命周期

扩展版的页面内容脚本在 Hentaiverse 页面内运行。它观察验证码 DOM、读取同源图片，并由 `RemoteDetectorClient` 将图片编码成带上限的 Base64 消息。`messages.ts` 是稳定协议聚合入口，具体协议校验、Port/Offscreen 消息和图片载荷分别位于 [`src/protocol/protocol-validation.ts`](../../apps/extension/src/protocol/protocol-validation.ts)、[`src/protocol/port-messages.ts`](../../apps/extension/src/protocol/port-messages.ts)、[`src/protocol/offscreen-messages.ts`](../../apps/extension/src/protocol/offscreen-messages.ts) 和 [`src/protocol/image-payload.ts`](../../apps/extension/src/protocol/image-payload.ts)；内容脚本入口和页面生命周期处理在 [`src/content/main.ts`](../../apps/extension/src/content/main.ts) 与 [`src/content/content-runtime.ts`](../../apps/extension/src/content/content-runtime.ts)。

请求沿着下面的路径传播：

```text
内容脚本
  -> runtime Port（content 名称）
  -> Broker（来源、协议、并发、超时、取消）
  -> Chromium：service worker -> Offscreen Document
     Firefox：background script 直接调用 Host
  -> InferenceHost
  -> OnnxWorkerClient -> runtime/inference-worker.js
  -> ONNX Runtime Web + 包内 WASM
  -> HostResponse -> 原路径返回
```

内容客户端为每个请求保存 `RequestLifecycle`，监听响应、断开和超时，并在用户取消时发送同一 Port 上的 request-scoped `cancel`。实现位于 [`src/content/remote-detector-client.ts`](../../apps/extension/src/content/remote-detector-client.ts) 和 [`src/protocol/request-lifecycle.ts`](../../apps/extension/src/protocol/request-lifecycle.ts)。客户端仅在存在活跃的非静默准备或识别请求时，将 Host 阶段广播和断连状态写入面板；单独的静默预热以及请求结束后的晚到广播不会改变面板。广播只更新模型/会话状态；推理状态保留在内容侧，因为只有内容侧能测量完整往返时间。

Broker 是受信边界：[`src/background/broker.ts`](../../apps/extension/src/background/broker.ts) 检查扩展 ID、内容页或设置页来源、端口名称、协议形状和请求 ID，再按端口及后台代际施加并发限制。它把每个 Host 调用绑定到 `AbortSignal`；端口断开、客户端取消或 Broker 超时都会终止对应请求。状态广播是单向的，不会结算请求。Broker 也广播凭证版本变化，并把持久化版本留给下一代内容脚本恢复。

Chromium 的 service worker 可随时重启，因此它不持有推理会话。[`src/background/chromium-bootstrap.ts`](../../apps/extension/src/background/chromium-bootstrap.ts) 为当前 worker 生成 epoch，接管并复用匹配的 Offscreen context，并将请求转为 Offscreen 消息；[`src/background/chromium-offscreen.ts`](../../apps/extension/src/background/chromium-offscreen.ts) 负责创建、并发准入和空闲关闭。Offscreen 页由 [`src/offscreen/offscreen-bootstrap.ts`](../../apps/extension/src/offscreen/offscreen-bootstrap.ts) 验证消息来源和 epoch，维护活动请求、取消历史、空闲通知退避，并在页面销毁时终止 Host。Firefox 不需要 Offscreen 转发，由 [`src/background/firefox-bootstrap.ts`](../../apps/extension/src/background/firefox-bootstrap.ts) 在 background script 中直接持有 Host。

Host 在 [`src/host/inference-host.ts`](../../apps/extension/src/host/inference-host.ts) 统一处理 `prepare`、`detect` 以及模型管理意图。推理请求解码图片后交给 Detector；模型管理请求按串行尾链执行，并以新一代操作取消旧操作。Host 销毁时同时终止 Detector、活动模型操作和底层资源。真正的 ONNX Worker 入口是 [`src/host/inference-worker-entry.ts`](../../apps/extension/src/host/inference-worker-entry.ts)，构建后成为 `runtime/inference-worker.js`。

构建器与运行时共同使用 [`src/platform/extension-paths.ts`](../../apps/extension/src/platform/extension-paths.ts) 的 `EXTENSION_PATHS` 定义入口路径。修改路径时须同步检查清单引用、设置页来源校验、Offscreen 创建和 Worker URL；产物目录树见[扩展产物说明](../browser-extension.md#build-outputs-and-local-loading)。

## 远程模型与内置模型边界

模型交付在构建时固定为 `remote` 或 `packaged`，运行时不会自动探测或回退。构建入口 [`scripts/build/build-extension.mjs`](../../apps/extension/scripts/build/build-extension.mjs) 将模式传给 [`scripts/build/target.mjs`](../../apps/extension/scripts/build/target.mjs)，后者选择背景、设置页和 Chromium Offscreen 入口。

远程模式由 [`src/host/remote-inference-host.ts`](../../apps/extension/src/host/remote-inference-host.ts) 组装：Key 只持久化在扩展源 IndexedDB，候选 Key 会短暂经过设置页 Port、Broker 和 Host 内存；它不写入普通存储、内容脚本消息、URL 或日志。模型下载经过共享模型缓存和完整性校验，成功写入缓存后才确认额度。设置页的验证、查询、下载和清除操作通过独立的 options Port 进入 Broker，见 [`src/options/remote.ts`](../../apps/extension/src/options/remote.ts)。

内置模式由 [`src/host/packaged-inference-host.ts`](../../apps/extension/src/host/packaged-inference-host.ts) 和包内模型/运行时资产组成。它不构造远程 Host 能力，不读取或修改旧 Key，也不声明模型服务 Host 权限；设置页只保留普通设置并禁用 Key 控件，见 [`src/options/packaged.ts`](../../apps/extension/src/options/packaged.ts)。包内模型由 [`src/host/packaged-asset.ts`](../../apps/extension/src/host/packaged-asset.ts) 执行状态、重定向、声明长度、实际长度和 SHA-256 校验。确定性的长度或哈希异常属于永久模型错误，模型及 WASM 的错误类别会通过严格校验的 Worker 响应保留，避免对同一损坏资产进行瞬时故障自动重试；网络和取消错误不归入完整性故障。构建后的远程/内置能力隔离还由 [`scripts/build/inventory.mjs`](../../apps/extension/scripts/build/inventory.mjs) 审计。

两种模式共用内容脚本、Broker、消息协议、推理 Worker 和普通设置，但远程专属模块不能被内置产物引用。扩展包中的 ORT glue、WASM 和 Worker 都是本地资源；扩展不通过远程可执行脚本运行。

## 设置、存储与同步

### 普通设置镜像

普通设置和历史存放在 `storage.local`，内容侧通过 [`src/content/storage-mirror.ts`](../../apps/extension/src/content/storage-mirror.ts) 建立同步内存镜像。镜像初始化期间先监听并合并变更，再读取全量快照；初始化有超时、取消和缓冲 Key 上限。写入按 Key 串行、以乐观值供当前页面读取，并在 `storage.onChanged` 提交后校正；前缀索引仅用于有限的历史扫描。`getCommittedItemsByPrefix()` 在该索引基础上还原每个未决键的已提交值，供历史裁剪使用；普通读取仍显示乐观值，本地未决删除和外部已提交变更同样参与快照校正。

### Key 提交与凭证修订

远程模式的模型 Key 使用 [`src/host/indexeddb-string-storage.ts`](../../apps/extension/src/host/indexeddb-string-storage.ts) 的独立 IndexedDB。内容脚本不接收 Key，普通设置加载流程只读取 `storage.local`，已保存的 Key 不回显到控件。Key 的原生 IndexedDB 事务提交回调独立于请求的取消结算：即使调用方已收到取消，仍驱动远程 Host 取消并等待共享 Detector 中尚未完成的旧初始化结束，覆盖静默预热及所有 Port 消费者；已经就绪的有效会话继续复用。提交前真正回滚不会通知，已关闭 Host 的迟到回调也不会重新启动同步。Firefox 通过注入回调、Chromium Offscreen 通过严格验证来源的 runtime 消息通知 Broker，不依赖原请求成功响应。Broker 再通过凭证版本消息和持久版本让已有内容页面在后台重启或 Key 修复后重新准备；Key 本身不进入内容脚本消息、URL、普通存储或日志。

### 设置页并发操作

设置页普通字段由 [`src/options/ordinary-settings.ts`](../../apps/extension/src/options/ordinary-settings.ts) 统一加载、解析、脏字段跟踪和串行保存。远程操作按代际取消旧请求；验证与清除还记录按钮点击时的输入修订号，成功返回只清空此后未编辑的输入，同样文字重新输入也会保留。额度查询在后台 Port 瞬断时只进行一次有限重连，验证和下载不自动重放，以避免重复副作用。页面销毁会取消未完成的 Key 操作。

## 取消、断连和恢复

取消分为三层：

1. 内容或设置页的 `AbortSignal` 先让本地 lifecycle 结算，并尽力发送 `cancel`。
2. Broker/Offscreen 将取消传播到 Host；活动请求从并发表中移除，过期响应不会覆盖新请求。
3. Host 将取消传给模型缓存、网络、IndexedDB 事务和推理 Worker；尚未开始的 detect 从可移除队列中直接删除并释放图片，不再保留到队头完成。运行中的 detect 仍等待 Worker 结束或取消宽限到期才放行下一项；销毁路径同时拒绝排队项并终止所有活动模型意图。

Port 断开会拒绝该 Port 上所有未决内容请求并允许下一次请求重新连接。Chromium 后台重启后，新的 epoch 会使旧 Offscreen 请求失效，再由新请求重新 claim；空闲 Offscreen 关闭失败会用有限次数的指数退避重试。Firefox 页面卸载直接销毁 Host。有关超时层级的权威说明见 [`src/protocol/deadlines.ts`](../../apps/extension/src/protocol/deadlines.ts)。

## 测试与证据对应关系

| 目标                                 | 对应测试/脚本                                                                                                                     | 能证明什么                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 协议 guard、消息大小和结果形状       | `test/protocol/messages.test.ts`                                                                                                  | 聚合入口及拆分后的 Port/Offscreen/image guard 不会放行未知消息            |
| 请求取消、超时、断连                 | `test/protocol/request-lifecycle.test.ts`, `test/content/remote-detector-client.test.ts`, `test/background/broker.test.ts`        | 单请求结算和 Port 级隔离                                                  |
| Chromium epoch、Offscreen 接管/回收  | `test/background/chromium-offscreen.test.ts`, `test/offscreen/offscreen-bootstrap.test.ts`, `test/background/bootstrap.test.ts`   | service worker 重启及空闲生命周期                                         |
| Host、模型缓存和资产校验             | `test/host/*.test.ts`, `test/options/*.test.ts`                                                                                   | 远程/内置组装、Key 存储、完整性与设置行为                                 |
| 内容存储镜像和页面生命周期           | `test/content/storage-mirror.test.ts`, `test/content/content-runtime.test.ts`                                                     | 快照合并、写入校正、pagehide/pageshow                                     |
| 构建隔离、清单、包体和可重复归档     | `scripts/build/build-extension.test.mjs`, `scripts/e2e/packaged-smoke-artifact.test.mjs`, `scripts/release/release-gate.test.mjs` | 产物结构和发布门禁的静态契约                                              |
| 基准参数、统计、结果校验、比较和 CSV | `scripts/benchmark/benchmark-contract.test.mjs`, `scripts/benchmark/benchmark-runner.test.mjs`                                    | 聚合入口导出、参数矩阵、统计口径、结果 schema、比较接受条件和可导出的 CSV |
| 真实浏览器内容链路                   | `scripts/e2e/chromium-content-smoke.mjs`                                                                                          | 本地 fixture 的 DOM、消息和原生提交                                       |
| 远程生产加载/鉴权                    | `scripts/e2e/chromium-load-smoke.mjs`, `scripts/e2e/firefox-load-smoke.mjs`                                                       | load-only 或受保护 Key 的明确边界；缺少 Key 时不声称鉴权通过              |
| 内置模型双浏览器推理                 | `scripts/e2e/chromium-packaged-model-smoke.mjs`, `scripts/e2e/firefox-packaged-model-smoke.mjs`                                   | 包内模型、会话重建和 fixture oracle                                       |

单元测试、构建审计和真实浏览器 smoke 证明的是不同边界，不能相互替代。最低版本、Firefox Android、商店发布和线上 Worker/R2 状态仍按 [`docs/browser-extension.md`](../browser-extension.md) 的发布矩阵单独验收。

## 评审时核对的跨上下文契约

| 边界               | 必须成立                                                         | 失败处理                                          |
| ------------------ | ---------------------------------------------------------------- | ------------------------------------------------- |
| 页面 → Broker      | extension id、Origin、具名 Port、schema、request id 与大小均合法 | 拒绝未识别来源与载荷，不把 unknown 直接断言为请求 |
| Broker → Offscreen | 当前 epoch、contextId 和可信 runtime sender 匹配                 | 后台重启或文档替换使旧请求失效，重新 claim        |
| Host → Worker      | 模型缓冲所有权明确；请求和结果严格校验                           | 取消、超时、永久完整性错误分别传播                |
| Key 事务 → 内容页  | 实际 commit 驱动协调，先等待旧初始化结束再广播                   | 调用方取消不撤销 commit；销毁后不重新通知         |
| 镜像 → 历史裁剪    | 删除只依据完整的已提交快照                                       | 读取失败跳过删除，失败乐观写不挤掉已保存记录      |

新操作若有写入或确认副作用，不能复用额度查询的一次自动重连策略。改动层级决定需运行的协议测试与浏览器场景，load-only、packaged 和 authenticated 不互相替代。
