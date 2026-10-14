# 模型缓存与计次策略

本文负责模型加载、IndexedDB 和下载确认的客户端契约；服务端状态机见 [Model Worker 架构](architecture/model-service.md)，精确字段见 [HTTP 参考](reference/model-worker-http.md)。

共用核心以 [ModelCache](../packages/browser-core/src/model/model-cache.ts) 编排，[IndexedDbModelStore](../packages/browser-core/src/model/indexeddb-model-store.ts) 管理事务，[model-cache-record.ts](../packages/browser-core/src/model/model-cache-record.ts) 校验记录，[shared-model-downloads.ts](../packages/browser-core/src/model/shared-model-downloads.ts) 共享下载。平台只注入 Key、fetch、Worker 或包内来源，不复制状态机。

## 缓存分层

| 客户端/资产                   | 来源与缓存                                                 |
| ----------------------------- | ---------------------------------------------------------- |
| 用户脚本模型                  | Worker `.ort`；页面源 IndexedDB                            |
| 远程模型扩展                  | Worker `.ort`；扩展源模型 IndexedDB，与 Key 存储分离       |
| 内置模型扩展                  | 包内 `model/yolo26n-640.ort`，`force-cache`，不访问 Worker |
| 用户脚本内置精简 Runtime WASM | 首方内容寻址 URL，公开一年 `immutable`                     |
| 扩展 Runtime WASM             | 随包分发的 `runtime/` 资产，不访问 Worker                  |

所有模型来源都执行最大长度、声明长度、实际长度和 SHA-256 校验。重定向、HTTP/完整性错误、下载或缓存事务失败的内容不能成为有效缓存。下载正文必须可流式读取；`body === null` 时失败，不退回无界 `arrayBuffer()`。Runtime profile 和字节读取细节见[资产专题](onnx-runtime.md)。

## 为什么模型响应保持 `no-store`

模型和错误响应使用 `Cache-Control: no-store`：访问受 `Authorization: Bearer` 控制，模型 URL 尚未内容寻址，共享缓存可能混淆 Key、Origin 和真实/诱饵对象。本地 IndexedDB 已提供通过完整性检查的复用。公开、内容寻址的精简 WASM 才使用长期 HTTP 缓存；query-string key 不授权真实模型。

模型 GET、额度查询或确认收到 403 时抛出 `ModelAccessKeyRejectedError`，按永久错误处理，提示重新验证 Key，不作瞬时重试。凭证实际提交后可通过既有恢复流程重试当前失败目标。错误正文仅尽力取消，不等待清理，不将 Key、URL 或正文带入提示。

## 下载完成后确认计次

默认每个规范化 Key、每个 UTC 自然月最多确认 5 次；ONNX 与 ORT 共用额度。Key 验证使用不计次的 HEAD，远程下载顺序为：

```text
GET 真实模型，预留十分钟回执（尚未计次）
  -> 有界读取，校验实际长度和 SHA-256
  -> IndexedDB 提交模型及待确认元数据
  -> POST /quota 确认回执
  -> 服务端计次，本地标记可命中
```

- `GET /quota` 只查询已确认次数；缓存命中不发模型 GET，也不计次。HEAD、OPTIONS、诱饵和 Runtime 同样不计次。
- 回执由 `X-HV-Model-Download-Receipt` 返回。下载/缓存失败不确认，预留自然失效；重复确认幂等，未知或过期回执返回 409。
- 5 次已确认后，真实 GET 在读取 R2 前返回 `429`；额度预检故障返回 `503`，也不读 R2。预检通过后仍须校验对象并原子预留；已确认与待确认合计占满时返回 `503`。
- `Retry-After` 对 429 指向下个 UTC 月，对预留占满的 503 指向最早回执过期；额度依赖故障的 503 使用短重试间隔，详见 HTTP 参考。
- `MODEL_DOWNLOAD_QUOTA_ENABLED=false` 时不预留或计次，查询显示无限制；有效 Key 提交合法回执仍返回 409，缺失/畸形回执返回 400，不伪造确认成功。

## 缓存可用性的三个阶段

| 阶段                       | 当前模型字节      | 后续实例可命中   |
| -------------------------- | ----------------- | ---------------- |
| 下载并通过实际字节校验     | 可交给推理 Worker | 否               |
| 二进制与待确认元数据提交   | 仍可用            | 否，仍须确认     |
| 服务端确认并更新匹配元数据 | 仍可用            | 是，读取时仍校验 |

上表适用于带回执的远程下载；无回执无需额外确认。确认失败后的记录必须视为未命中，后续实例重新下载；升级前缺少确认字段的记录也失效。

调用路径决定错误如何呈现：[OnnxWorkerClient](../packages/browser-core/src/inference/onnx-worker-client.ts) 在会话初始化后尽力缓存，缓存/确认失败可继续使用已就绪会话，但父请求取消或销毁仍终止处理；扩展设置页的显式下载会报告缓存/确认失败，不能把“内存字节可用”当成“下载并缓存成功”。

## 事务身份与迟到确认

数据库版本仍为 1，使用 `models` store。初始事务同时写模型行和 `${cacheKey}:confirmation` 元数据行，以随机 `cacheWriteId`、版本、长度、SHA-256 绑定。确认成功只更新匹配元数据，不重写二进制，旧确认不能覆盖新下载。

带 `cacheWriteId` 的模型必须有匹配且已确认的元数据才能命中；旧格式中明确 `confirmationPending=false` 的记录仍可读取，缺字段或待确认记录失效。命中时同时检查版本、清单身份和实际字节。失败日志不得包含 Key 或回执。

## 取消与缓冲区所有权

调用方取消、缓存关闭、IndexedDB `versionchange` 或操作超时须取消底层确认请求；关闭/versionchange 还取消数据库操作和共享下载。取消后的晚到成功不能清除内存回执或写本地确认状态，也不能宣称撤销服务端已计次数。缓存读取的生命周期取消必须向上传播，不能吞成未命中后再下载。

同一缓存实例中，Key 与完整性选项相同的并发消费者共享网络 GET，但各自取得独立、可转移的 `ArrayBuffer` 及同一幂等回执。一个 Worker 转移缓冲区不会 detach 其他消费者的字节；最后一个等待者离开时才取消尚未完成的共享下载。

## 重新评估 HTTP 缓存的条件

调整模型 HTTP 缓存前，须同时满足：不可变模型 URL；验证授权、Origin 和真实/诱饵隔离；发布门禁原子绑定版本、URL、对象键、长度和 SHA-256；回滚保留旧对象及旧客户端访问能力。模型、额度、诱饵和 Runtime 仍分别制定策略。

## 变更前验证

先按[验证手册](development/verification.md#model-worker-测试配置)备份生成配置并准备 Worker 测试绑定，再按受影响范围运行：

```bash
mise exec -- pnpm --filter @hv-pony-solver/browser-core test
mise exec -- pnpm --filter @hv-pony-solver/userscript test
mise exec -- pnpm --filter @hv-pony-solver/extension test
mise exec -- pnpm --filter @hv-pony-solver/model-worker test
mise exec -- pnpm docs:check
```

覆盖缓存命中、实际字节漂移、事务失败、确认代次、取消/versionchange、并发缓冲区所有权，以及服务端幂等、TTL、UTC 月切换、5 次上限、预留占满和额度关闭。真实/诱饵隔离与受保护鉴权另行验收。
