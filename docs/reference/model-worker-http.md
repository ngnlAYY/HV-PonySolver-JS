# Model Worker HTTP 契约

本文维护当前路由、鉴权、状态码、CORS 和缓存字段。内部实现见[服务架构](../architecture/model-service.md)，部署见[运维手册](../model-worker-ops.md)，客户端事务见[缓存策略](../model-cache-strategy.md)。

## 路由

| 默认路径                                | 方法                 | 鉴权与成功响应                                                                      |
| --------------------------------------- | -------------------- | ----------------------------------------------------------------------------------- |
| `/yolo26n-640.onnx`、`/yolo26n-640.ort` | `GET, HEAD, OPTIONS` | Bearer Key 决定真实/诱饵对象；`application/octet-stream`，`Cache-Control: no-store` |
| `/quota`                                | `GET, POST, OPTIONS` | 必须真实 Key；`application/json; charset=utf-8`，`Cache-Control: no-store`          |
| `/runtime/ort-wasm-simd-<sha256>.wasm`  | `GET, HEAD, OPTIONS` | 公开 WASM；`application/wasm`，`Cache-Control: public, max-age=31536000, immutable` |

Runtime 表中的 `<sha256>` 只是缩写，路由仅匹配配置中的一个完整 pathname，不接受任意哈希。精确路径、对象键和字节身份见[资产清单](../onnx-runtime.md#r2-资产)。OPTIONS 不鉴权，返回 204；未知路径返回 404。

自定义公开路径须已是规范 pathname，禁止 URL 解析会改变的点段、原始空格/Unicode 及 `//` 路径；有效百分号编码原样匹配。渲染与运行时校验同时检查全部显式和默认路径的唯一性，无效配置返回通用 500，而不是继续匹配其他路由。

模型和 WASM 成功响应附 `Content-Length`、`X-Content-Type-Options: nosniff`，R2 提供 `httpEtag` 时附 `ETag`。模型另有 `Content-Disposition: inline; filename="…"`：文件名取公开路径最后一段，尾斜杠时回退到共享标准名。HEAD 只读取 R2 元数据并返回对象响应头，无正文、下载回执或额度操作；不能用 HEAD 证明 GET 尚有额度。

文本错误使用 `text/plain; charset=utf-8`、`no-store` 和 `nosniff`。真实 ONNX、ORT 和公开 WASM 的 R2 长度须精确匹配清单；已记录的 SHA-256 也须匹配。缺 SHA 元数据兼容旧对象，客户端仍校验实际字节；元数据读取异常或漂移失败关闭。

## 响应矩阵

| 请求或情况                                                                           | HTTP 契约                                                                                                                                       |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /yolo26n-640.onnx` 携带 `Authorization: Bearer <authorized-64-hex>` 且 KV 命中  | 额度允许且对象有效时 `200` 真实模型，模型响应使用 `Cache-Control: no-store`；启用额度时附临时回执。`GET /yolo26n-640.ort` 相同                  |
| `GET /quota` 携带有效 Bearer token                                                   | `200` JSON，仅报告已确认次数，不计次；字段见下表                                                                                                |
| `POST /quota` 携带有效 Bearer token 和 `X-HV-Model-Download-Receipt`                 | 有效待确认/已确认回执返回 `200` JSON，首次确认计一次，重复确认幂等；未知、过期或限制关闭返回 `409`；缺失/畸形回执返回 `400`                     |
| `HEAD /yolo26n-640.onnx` 携带 `Authorization: Bearer <authorized-64-hex>` 且 KV 命中 | 对象有效时 `200`，只读取元数据，不返回正文或回执；ORT 路由相同                                                                                  |
| `OPTIONS /yolo26n-640.onnx`                                                          | `204`，`Access-Control-Allow-Methods: GET, HEAD, OPTIONS`，`Access-Control-Allow-Headers: Authorization`；ORT 相同                              |
| `OPTIONS /quota`                                                                     | `204` preflight，`Access-Control-Allow-Methods: GET, POST, OPTIONS`，`Access-Control-Allow-Headers: Authorization, X-HV-Model-Download-Receipt` |
| `OPTIONS /runtime/ort-wasm-simd-<sha256>.wasm`                                       | `204`，`Access-Control-Allow-Methods: GET, HEAD, OPTIONS`，`Access-Control-Allow-Origin: *`，不声明允许的请求头                                 |
| 非 `GET` / `HEAD` / `OPTIONS` 方法                                                   | 模型和 Runtime 返回 `405 Method Not Allowed`，`Allow: GET, HEAD, OPTIONS`；额度路由不支持的方法使用 `Allow: GET, POST, OPTIONS`                 |
| 同一 Key 当月已确认 5 次，再次 GET 真实模型                                          | `429`，正文 `Monthly model download quota exceeded`；`Retry-After` 为距下个 UTC 月的秒数                                                        |
| 已确认与有效 pending 合计占满 5 个槽位                                               | `503 Service Unavailable`；`Retry-After` 为距最早 pending 过期或下个 UTC 月界的较小秒数，向上取整且至少一秒                                     |
| 额度查询、预留或确认依赖失败                                                         | `503 Service Unavailable`，`Retry-After: 5`                                                                                                     |
| 选中的 R2 object 缺失                                                                | `500 Internal Server Error`                                                                                                                     |
| 真实模型/Runtime 的长度、已有 SHA-256 元数据漂移，或 GET 对象缺少 body               | `500 Internal Server Error`，不返回对象内容、不预留额度                                                                                         |

所有 OPTIONS 使用 `Cache-Control: no-store`、`Access-Control-Max-Age: 86400`。429/503 通过 `Access-Control-Expose-Headers: Retry-After` 暴露重试头；启用额度的真实 GET 通过 `Access-Control-Expose-Headers: X-HV-Model-Download-Receipt` 暴露回执。

启用额度时，真实 GET 先只读查询已确认次数：耗尽返回 429，查询失败返回 503，两者均不读取 R2；通过后读取、校验对象，再原子 reserve。对象缺失不回退到其他对象。预检不判断 pending 是否占满，最终预留仍可返回 429/503。

| JSON 响应                                          | 字段                                                                                                        |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /quota`，限制开启                             | `enabled=true`、`limit=5`、`used`、`remaining=5-used`、`retryAfterSeconds`（距下个 UTC 月）                 |
| `GET /quota`，`MODEL_DOWNLOAD_QUOTA_ENABLED=false` | `enabled=false`、`limit=0`、`used=0`、`remaining=null`、`retryAfterSeconds=null`；表示无限制                |
| `POST /quota` 成功                                 | `confirmed=true`、`alreadyConfirmed`、`used`、`remaining`、`retryAfterSeconds`；不包含 `enabled` 或 `limit` |

公开额度 JSON 仅包含上表列出的字段；内部 DO 响应的额外字段不会透传或覆盖额度开关。月份与回执到期判断使用状态读取完成后的当前时间，覆盖异步存储等待跨边界的情况。

回执是 32 位十六进制，服务端去除首尾空白并转小写后校验；预留有效期十分钟。客户端必须用同一 Key，在完整读取、校验并提交 IndexedDB 缓存后确认；POST 不需要请求正文。ONNX/ORT 共用每 Key、每 UTC 自然月 5 次，HEAD、OPTIONS、诱饵和 Runtime 不计次。关闭限制不发回执、不计次，合法确认明确返回 409，畸形回执仍先返回 400；没有 cancel 端点。

## 鉴权

```http
Authorization: Bearer <64位十六进制token>
```

Bearer 名称不区分大小写；服务端以小写 token 计算身份，KV 对 canonical、原始和历史大写变体做兼容查询，非空白标记才授权。客户端保存及发送已验证 Key 时保留原始大小写，避免丢失历史混合大小写 KV 的查询候选。query-string key 不授权真实模型；按缺少 Bearer token 处理。`?key=` 和 `?token=` 均不受支持，无效 Bearer 不回退到 query。

`INVALID_KEY_MODE=decoy`（默认）使无效/缺失 Key 的模型请求选择诱饵，对象正常时返回 200；`error` 返回 403。`/quota` 在两种模式下都对无效 Key 返回 403，且先鉴权再校验回执。诱饵仅隐藏直接状态差异，不保证长度或耗时不可区分。

客户端通过认证 `GET /quota` 验证 Key，不再比较模型 HEAD 的 `Content-Length`；合法耗尽或禁用额度仍视为有效。该操作不访问 R2、不预留回执、不确认下载；额度读取故障会使验证失败，不能把 Key 验证当作模型下载或实际推理证据。

## CORS

模型、额度和通用错误只对 `https://hentaiverse.org`、`https://alt.hentaiverse.org` 精确回显 `Access-Control-Allow-Origin`；未知 Origin 不获该头。没有 Origin 时使用 `*`，这些响应均追加 `Vary: Origin`。

公开 WASM 的成功响应与 OPTIONS 使用 `Access-Control-Allow-Origin: *`；WASM 错误仍使用上面的通用错误策略。CORS 限制浏览器读取权限，不能代替 Key 鉴权。

## 事实来源与验证

[request-router.ts](../../apps/model-worker/src/request-router.ts) 定义路由和时序，[model-response.ts](../../apps/model-worker/src/model-response.ts) 定义响应头，[model-access.ts](../../apps/model-worker/src/model-access.ts) 定义鉴权。`mise exec -- pnpm docs:check` 校验文档事实；协议修改还需 Worker 和相关客户端测试，文档检查不探测线上服务。
