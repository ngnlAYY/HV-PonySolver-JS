# 模型缓存与计次策略

最后复核：2026-09-08。

实现导航：浏览器核心的编排入口是 [`ModelCache`](../packages/browser-core/src/model/model-cache.ts)，IndexedDB 事务由 [`IndexedDbModelStore`](../packages/browser-core/src/model/indexeddb-model-store.ts) 管理，记录校验由 [`model-cache-record.ts`](../packages/browser-core/src/model/model-cache-record.ts) 负责，共享下载由 [`shared-model-downloads.ts`](../packages/browser-core/src/model/shared-model-downloads.ts) 负责。用户脚本和扩展只注入各自的 Key、Fetch、Worker 或包内模型来源，不应在适配层复制缓存状态机。

## 当前决策

模型响应继续使用 `Cache-Control: no-store`。浏览器在完整性验证后自行维护私有本地缓存；Model Worker 不允许共享边缘缓存真实模型、诱饵模型或额度错误。

不同客户端的模型来源与缓存如下：

| 客户端/构建                   | 模型来源                               | 本地缓存或读取方式                         |
| ----------------------------- | -------------------------------------- | ------------------------------------------ |
| 用户脚本                      | Model Worker 的 `.ort` 路由            | 浏览器 IndexedDB，命中后不重新下载         |
| 远程模型扩展                  | Model Worker 的 `.ort` 路由            | 扩展源模型 IndexedDB，与 Key 存储分离      |
| 内置模型扩展                  | 包内 `model/yolo26n-640.ort`           | 扩展内部 URL，`force-cache`，不访问 Worker |
| 用户脚本内置精简 Runtime WASM | 首方内容寻址 Runtime 路由              | 浏览器 HTTP 缓存，公开一年 `immutable`     |
| 扩展 Runtime WASM             | 扩展包内 `runtime/<content-hash>.wasm` | 随扩展安装，不访问 Worker                  |

无论来源如何，模型都必须同时通过声明长度、实际长度、最大长度和 SHA-256 校验。下载中断、重定向、HTTP 错误、长度异常、哈希异常或缓存事务失败的内容不得成为有效缓存。

## 为什么模型响应保持 `no-store`

- 模型访问由 `Authorization: Bearer` 控制，query-string key 不会授权真实模型。
- 当前 `/yolo26n-640.onnx` 和 `/yolo26n-640.ort` 路径都不是不可变的内容寻址 URL。
- 没有经过验证的 token-aware 缓存规则时，共享缓存可能扩大授权边界，或让不同 Key、Origin、真实/诱饵对象互相污染。
- 浏览器已有带完整性契约的 IndexedDB 缓存，重复下载收益主要在客户端侧实现。
- `403`、`409`、`429`、`500` 和 `503` 等错误同样必须 `no-store`，避免某个 Key 或一次临时故障污染其他请求。
- `429` 只通过 `Retry-After` 表示下个 UTC 月边界；`503` 可通过 `Retry-After` 表示最早待确认回执的失效时间。

公开的精简 Runtime WASM 是例外：URL 含完整 SHA-256，响应不需要 Key，使用一年 `public, immutable` 缓存。

## 下载完成后确认计次

额度默认按每个规范化 Key、每个 UTC 自然月最多 5 次已确认模型缓存计算，ONNX 与 ORT 共用同一额度。一次远程模型操作的状态变化如下：

```text
HEAD 验证 Key（不计次）
  -> GET 真实模型并预留十分钟回执（尚未计次）
  -> 客户端有界读取并校验长度/SHA-256
  -> IndexedDB 缓存事务提交
  -> POST /quota 确认回执
  -> 已用次数 +1
```

关键边界：

- `GET /quota` 只查询 `enabled`、`limit`、`used`、`remaining` 和 `retryAfterSeconds`，不计次。
- 有效本地缓存命中时不发起模型 `GET`，也不消耗次数。
- 模型 `GET` 只返回 `X-HV-Model-Download-Receipt` 并占用临时槽位，不立即递增 `used`。
- 模型与 Runtime 下载只接受可流式读取的响应正文；`body === null` 时失败关闭，不使用无法在分配前执行大小上限的 `arrayBuffer()` fallback。
- 客户端只有在模型完整读取、校验且成功写入 IndexedDB 后才确认；下载或缓存失败时不确认，回执自然失效。
- 同一回执重复确认是幂等操作，不会重复计次；未知或失效回执返回 `409`。
- 5 次已经确认后，新的真实模型 `GET` 在读取 R2 前通过只读额度预检返回不可缓存的 `429`；预检查询失败返回 `503`，同样不读取 R2。允许继续的请求仍在对象完整性检查后原子预留回执；已确认与待确认槽位合计达到 5 且仍有回执未失效时，返回可重试的 `503`，避免并发越过硬上限。
- `HEAD`、`OPTIONS`、诱饵模型和 Runtime 不计次。
- `MODEL_DOWNLOAD_QUOTA_ENABLED=false` 时不预留、不确认也不递增次数；查询明确显示“无次数限制”，而不是伪造有限的剩余次数；格式正确的意外确认请求返回 `409`，缺失或畸形回执返回 `400`，不得伪造确认成功。

缓存事务先把远程模型记录标记为“待确认”；只有 `POST /quota` 成功后才写回可命中状态。确认失败不会阻止当前调用继续使用已经验证的内存字节，但该 IndexedDB 记录在后续实例或重启后必须视为未命中并重新下载，不能因内存回执丢失而永久绕过计次。升级前缺少确认状态字段的旧缓存也会一次性失效。失败日志不得包含 Key 或回执。

数据库继续使用版本 1 的 `models` store。首次写入在同一事务内保存模型行与 `${cacheKey}:confirmation` 元数据行，以随机 `cacheWriteId`、版本、长度和 SHA-256 绑定；确认成功后只更新元数据，不再次写入模型二进制。更新前必须比较写入身份，较晚完成的旧确认不能覆盖新下载的状态。带 `cacheWriteId` 的模型行只有匹配的元数据明确完成确认时才能命中；旧格式中明确 `confirmationPending=false` 的记录仍可读取，缺失或待确认记录仍失效。

`ModelCache` 保留原有调用接口，IndexedDB 生命周期、记录校验和共享下载分别由 `indexeddb-model-store`、`model-cache-record`、`shared-model-downloads` 管理。关闭缓存或收到 `versionchange` 时同时取消数据库操作和共享下载。

并发消费者只共享同一次网络 GET；每个仍在等待的消费者获得独立、可转移的 `ArrayBuffer` 所有权，并复制同一幂等确认回执。这样一个推理 Worker 转移缓冲区时不会把另一个缓存调用的字节 detach。

维护时先区分三种结果：缓存命中表示记录和确认元数据均通过校验；下载成功表示内存中的模型可供当前推理使用；缓存确认失败表示当前调用仍可继续，但后续实例必须重新下载。涉及取消、`versionchange`、并发下载或确认代次时，至少检查核心 `test/model` 中的缓存、下载和完整性测试，并同步检查用户脚本与扩展的模型来源测试。

## 未来可选方案

只有同时满足以下条件，才评估调整模型 HTTP 缓存：

1. 模型 URL 改为不可变版本或内容寻址路径。
2. 明确禁止共享缓存，或验证 `Authorization`、`Origin` 与真实/诱饵选择不会跨请求泄漏。
3. 发布流程生成并门禁 version、URL、R2 object key、byteLength 和 SHA-256 的原子映射。
4. 回滚保留旧版 R2 object，并能让既有客户端继续请求旧身份。
5. 真实模型、诱饵模型、额度响应和 Runtime 分别评估，不能套用一个全局缓存策略。

## 变更前验证

修改缓存、下载或额度确认逻辑时至少运行：

```bash
mise exec -- pnpm --filter @hv-pony-solver/browser-core test
mise exec -- pnpm --filter @hv-pony-solver/userscript test
mise exec -- pnpm --filter @hv-pony-solver/extension test
mise exec -- pnpm --filter @hv-pony-solver/model-worker test
mise exec -- pnpm docs:check
```

手动验收应覆盖缓存命中、完整性失败、IndexedDB 写入失败、重复确认、回执失效、5 次已确认、并发预留占满、UTC 月切换、额度关闭以及真实/诱饵对象隔离。
