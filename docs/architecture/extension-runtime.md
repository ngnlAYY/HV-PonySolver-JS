# 扩展上下文与生命周期

本文面向消息、后台、Key 事务、设置镜像与 Host 的维护者。构建模式、权限、产物和验收见[扩展产品手册](../browser-extension.md)，共享 DOM/答案流程见[浏览器核心](browser-runtime.md)。

## 模块导航

以下路径相对于 `apps/extension/`，源码测试位于对应的 `test/<area>/`。

| 目录                                                   | 职责                                      |
| ------------------------------------------------------ | ----------------------------------------- |
| [src/content](../../apps/extension/src/content/)       | DOM、内容 Port、设置镜像、预热            |
| [src/background](../../apps/extension/src/background/) | Broker、后台生命周期、Offscreen 准入      |
| [src/offscreen](../../apps/extension/src/offscreen/)   | Chromium Host 中转、epoch、取消与空闲回收 |
| [src/host](../../apps/extension/src/host/)             | Detector、远程/内置模型、Key、资产校验    |
| [src/protocol](../../apps/extension/src/protocol/)     | 消息 guard、图片载荷、截止时间、请求结算  |
| [src/platform](../../apps/extension/src/platform/)     | WebExtension API 最小适配层               |
| [src/options](../../apps/extension/src/options/)       | 普通设置与模型管理界面                    |

脚本按 `build/benchmark/browser/e2e/fixtures/model/release` 分组，入口与测试见[扩展手册](../browser-extension.md#script-and-test-entry-points)。

平台适配层只暴露最小的运行时、存储、Offscreen 和 action 能力。业务模块不要直接读取 `globalThis.browser`/`chrome`，协议边界也不要绕过 `unknown` guard。

## 一次识别请求的生命周期

内容脚本观察 Hentaiverse DOM 并读取同源图片，`RemoteDetectorClient` 编码为有上限的 Base64 消息。协议从 [messages.ts](../../apps/extension/src/protocol/messages.ts) 聚合导出，具体 guard、Port/Offscreen 消息和图片处理按[协议目录](../development/directory-layout.md#协议和测试目录)拆分；页面生命周期由 [content-runtime.ts](../../apps/extension/src/content/content-runtime.ts) 管理。

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

[内容客户端](../../apps/extension/src/content/remote-detector-client.ts) 为每个请求创建 [RequestLifecycle](../../apps/extension/src/protocol/request-lifecycle.ts)，监听响应、断连和超时；取消时在同一 Port 发送指定 request id 的 `cancel`。仅非静默 prepare/detect 活动期间，Host 广播和断连才更新面板的模型/会话状态。推理状态在内容侧统计，初始化往返用同页 `performance.now()` 取整；静默、取消、超时、销毁及请求结束后的广播不写就绪耗时。

[Broker](../../apps/extension/src/background/broker.ts) 在监听消息前校验扩展 ID、实际 `sender.url` 与 Port 名称，再校验 schema/request id 并按端口与后台代际限流。它不以 `sender.tab.url` 兜底；`sender.origin`、`frameId` 与 HTTPS origin 的规则见[来源边界](../browser-extension.md#runtime-architecture)。每个 Host 调用绑定 `AbortSignal`，断连、取消或超时终止对应请求。单向状态广播不结算请求；凭证版本同时广播与持久化，供下一代内容脚本恢复。

Chromium service worker 不持有推理会话。[chromium-bootstrap.ts](../../apps/extension/src/background/chromium-bootstrap.ts) 每次启动生成 epoch 并接管匹配的 Offscreen context；[chromium-offscreen.ts](../../apps/extension/src/background/chromium-offscreen.ts) 管理创建、准入与空闲关闭。[Offscreen 入口](../../apps/extension/src/offscreen/offscreen-bootstrap.ts) 校验来源/epoch，维护活动请求、取消历史和空闲通知退避，销毁时终止 Host。Firefox 的 [bootstrap](../../apps/extension/src/background/firefox-bootstrap.ts) 在 background script 直接持有 Host。

[InferenceHost](../../apps/extension/src/host/inference-host.ts) 解码图片后调用 Detector，模型管理意图通过串行尾链执行，新代际取消旧操作；销毁终止 Detector、模型操作和底层资源。[Worker 入口](../../apps/extension/src/host/inference-worker-entry.ts) 构建为 `runtime/inference-worker.js`。

构建与运行时共用 [EXTENSION_PATHS](../../apps/extension/src/platform/extension-paths.ts)；路径变更须核对清单、设置页来源、Offscreen 和 Worker URL。[产物目录](../browser-extension.md#build-outputs-and-local-loading)保持同步。

## 远程模型与内置模型边界

构建入口 [build-extension.mjs](../../apps/extension/scripts/build/build-extension.mjs) 将固定模式传给 [target.mjs](../../apps/extension/scripts/build/target.mjs)，选择后台、设置页和 Offscreen 入口；运行时不自动探测或回退。

[remote-inference-host.ts](../../apps/extension/src/host/remote-inference-host.ts) 组装模型缓存与 Key IndexedDB；下载校验并写入后才确认额度。[远程设置页](../../apps/extension/src/options/remote.ts) 经独立 options Port 验证、查询、下载或清除。候选 Key 只短暂经过该 Port、Broker 与 Host 内存，不进入内容消息、普通存储、URL 或日志。

[packaged-inference-host.ts](../../apps/extension/src/host/packaged-inference-host.ts) 只组装包内资产，不构造远程能力、不读改旧 Key、不声明模型服务 Host 权限；[设置页](../../apps/extension/src/options/packaged.ts) 禁用 Key 控件。[packaged-asset.ts](../../apps/extension/src/host/packaged-asset.ts) 校验状态、重定向、声明/实际长度及 SHA-256。确定性模型/WASM 完整性错误经严格 Worker 协议保留永久分类，不自动重试；网络与取消另行分类。

两模式共用内容脚本、Broker、协议、Worker 和普通设置；远程专属模块不得进入内置产物，可执行资产一律随包分发。完整清单/CSP/HTML 审计见[权限契约](../browser-extension.md#permission-matrix)，故障注入覆盖双浏览器、双模式的 `scripts/build/inventory-security.test.mjs`。

## 设置、存储与同步

### 普通设置镜像

普通设置与历史存于 `storage.local`，[storage-mirror.ts](../../apps/extension/src/content/storage-mirror.ts) 提供内容侧同步镜像。初始化先监听再读快照，合并变更并限制期限、取消与不同 key 数量。写入按 key 串行，乐观值供普通读取，`storage.onChanged` 后校正。有限前缀索引用于历史扫描；`getCommittedItemsByPrefix()` 还原未决键的已提交值，包含未决删除与外部写入，供安全裁剪。

销毁拒绝尚未开始的写入/删除，包括首个微任务；已发起调用仍按真实结果结算，不能撤销已提交变更。预先取消不注册监听器、不读取快照。

### Key 提交与凭证修订

Key 使用 [indexeddb-string-storage.ts](../../apps/extension/src/host/indexeddb-string-storage.ts) 的独立 IndexedDB，不回显、不进入内容脚本。原生事务 commit 独立于请求取消结算：即使调用方已取消，仍驱动 Host 取消并等待共享 Detector 的旧初始化，覆盖静默预热与所有 Port；就绪会话继续复用。提交前回滚不通知，Host 关闭后的迟到回调不恢复同步。

Firefox 注入回调、Chromium Offscreen 发送严格来源校验的 runtime 消息，均不依赖原请求成功响应。Broker 广播并持久化凭证修订号，让内容页在后台重启或 Key 修复后重新准备；广播不包含 Key。

### 设置页并发操作

[ordinary-settings.ts](../../apps/extension/src/options/ordinary-settings.ts) 管理普通字段加载、解析、脏状态与串行保存。远程操作按代际取消旧请求；验证/清除成功只清空点击后未编辑的输入，重新输入同样文字也保留。仅额度查询在 Port 瞬断后重连一次，其他操作不自动重放；页面销毁取消未完成操作。

## 取消、断连和恢复

取消分为三层：

1. 内容或设置页的 `AbortSignal` 先让本地 lifecycle 结算，并尽力发送 `cancel`。
2. Broker/Offscreen 将取消传播到 Host；活动请求从并发表中移除，过期响应不会覆盖新请求。
3. Host 将取消传给模型缓存、网络、IndexedDB 事务和推理 Worker；尚未开始的 detect 从可移除队列中直接删除并释放图片，不再保留到队头完成。运行中的 detect 仍等待 Worker 结束或取消宽限到期才放行下一项；销毁路径同时拒绝排队项并终止所有活动模型意图。

Port 断开会拒绝该 Port 上所有未决内容请求并允许下一次请求重新连接。Chromium 后台重启后，新的 epoch 会使旧 Offscreen 请求失效，再由新请求重新 claim；空闲 Offscreen 关闭失败会用有限次数的指数退避重试。同一空闲代际的 confirm-idle 只确认空闲，不重置退避或次数预算；新活动/新代际才重新获得预算。Firefox 页面卸载直接销毁 Host。有关超时层级的权威说明见 [`src/protocol/deadlines.ts`](../../apps/extension/src/protocol/deadlines.ts)。

所有 `onDisconnect` 回调通过 [readPortDisconnectError](../../apps/extension/src/platform/webextension-runtime.ts) 同步读取 Chromium `runtime.lastError`，兼容 Firefox `port.error`。失效 Port 也先读取再判身份，不能推迟到 Promise continuation，否则可能报告 `Unchecked runtime.lastError`。内容/设置页保留原因并拒绝未决请求，Broker 取消 Host 工作，不为预期页面离开额外记日志。

BFCache 的 `pagehide.persisted` 销毁应用并取消工作，`pageshow.persisted` 重建镜像/应用并按需建新 Port；读取错误不触发重放。依据与回归见[断连错误决定](../decisions/implemented/bug-fix/2026-09-18-extension-port-disconnect-errors.md)。

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
