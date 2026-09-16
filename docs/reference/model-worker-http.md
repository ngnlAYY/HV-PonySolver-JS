# Model Worker HTTP 契约

本文面向客户端和服务端维护者，描述当前请求、状态码、CORS 与缓存行为。服务实现见[Model Worker 架构](../architecture/model-service.md)，发布操作见[运维手册](../model-worker-ops.md)，客户端下载与确认顺序见[缓存策略](../model-cache-strategy.md)。

## 路由

| 路径                                   | 鉴权         | R2 对象                    | 缓存策略          |
| -------------------------------------- | ------------ | -------------------------- | ----------------- |
| `/yolo26n-640.onnx`                    | Bearer token | 旧版真实模型或诱饵对象     | `no-store`        |
| `/yolo26n-640.ort`                     | Bearer token | 新版真实模型或诱饵对象     | `no-store`        |
| `/quota`                               | Bearer token | 本 Key 的月度下载次数 JSON | `no-store`        |
| `/runtime/ort-wasm-simd-<sha256>.wasm` | 公开         | 精简 WASM                  | 一年、`immutable` |

模型与 Runtime 路由支持的方法：

```text
GET, HEAD, OPTIONS
```

`/quota` 支持 `GET, POST, OPTIONS`：`GET` 查询次数，`POST` 在客户端完成完整性校验和 IndexedDB 缓存后确认一次下载。

- 未知路径返回 `404`。
- 模型和 Runtime 路由不支持的方法返回 `405`，并设置 `Allow: GET, HEAD, OPTIONS`；`/quota` 的 `Allow` 为 `GET, POST, OPTIONS`。
- `HEAD` 返回与 `GET` 一致的响应头，但不返回响应体。
- 模型响应使用 `application/octet-stream` 和 `Cache-Control: no-store`。
- 模型响应的 `Content-Disposition` 文件名取对应公开路径的最后一段；路径以 `/` 结尾时回退到共享清单中的标准文件名。
- WASM 响应使用 `application/wasm` 和 `Cache-Control: public, max-age=31536000, immutable`。
- 文本错误响应使用 `no-store` 和 `X-Content-Type-Options: nosniff`。
- 真实 ONNX、真实 ORT 和公开 Runtime 在返回响应或预留额度前，必须匹配共享清单中的精确 R2 对象长度；若 R2 对象带 SHA-256 元数据，该值也必须匹配。元数据读取异常或任一值漂移时返回通用 `500`。
- `GET /quota` 只读并返回 `enabled`、`limit`、`used`、`remaining` 和 `retryAfterSeconds`，不会消耗次数。
- 真实模型 `GET` 返回临时 `X-HV-Model-Download-Receipt`，但此时不递增次数；客户端读取并校验完整模型、完成 IndexedDB 事务后，才使用同一 Key 和回执调用 `POST /quota`。
- 同一 Key 的 ONNX 与 ORT 缓存确认共用每个 UTC 自然月 5 次额度；重复确认同一回执是幂等的，未完成或已失效的回执不计数。`HEAD`、`OPTIONS`、诱饵模型和 Runtime 不计数。`MODEL_DOWNLOAD_QUOTA_ENABLED=false` 时不执行额度限制，也不递增计数；此时格式正确的 `POST /quota` 返回 `409`，不会伪造一次成功确认，缺失或畸形回执仍返回 `400`。

## 响应矩阵

| 请求或情况                                                                           | HTTP 契约                                                                                                                                                                            |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /yolo26n-640.onnx` 携带 `Authorization: Bearer <authorized-64-hex>` 且 KV 命中  | `200` 真实模型，模型响应使用 `Cache-Control: no-store` 并返回临时回执；`GET /yolo26n-640.ort` 使用相同契约                                                                           |
| `GET /quota` 携带有效 Bearer token                                                   | `200` JSON 额度状态；只报告已确认的缓存下载，不消耗下载次数                                                                                                                          |
| `POST /quota` 携带有效 Bearer token 和 `X-HV-Model-Download-Receipt`                 | 有效待确认回执返回 `200` 并将该 Key 的已用次数递增一次；重复提交已确认回执仍返回 `200` 且不重复计数，失效、未知回执或额度限制已关闭时返回 `409`；缺失或畸形回执返回 `400`            |
| `HEAD /yolo26n-640.onnx` 携带 `Authorization: Bearer <authorized-64-hex>` 且 KV 命中 | `200`，只读取 R2 元数据且不返回响应体；`HEAD /yolo26n-640.ort` 使用相同契约                                                                                                          |
| `OPTIONS /yolo26n-640.onnx`                                                          | `204` preflight，`Access-Control-Allow-Methods: GET, HEAD, OPTIONS`，`Access-Control-Allow-Headers: Authorization`；`OPTIONS /yolo26n-640.ort` 使用相同策略，预检缓存上限为 86400 秒 |
| `OPTIONS /quota`                                                                     | `204` preflight，`Access-Control-Allow-Methods: GET, POST, OPTIONS`，`Access-Control-Allow-Headers: Authorization, X-HV-Model-Download-Receipt`，预检缓存上限为 86400 秒             |
| `OPTIONS /runtime/ort-wasm-simd-<sha256>.wasm`                                       | `204` preflight，`Access-Control-Allow-Methods: GET, HEAD, OPTIONS`，`Access-Control-Allow-Origin: *`，不声明允许的请求头，预检缓存上限为 86400 秒                                   |
| 非 `GET` / `HEAD` / `OPTIONS` 方法                                                   | 模型路由返回 `405 Method Not Allowed`，`Allow: GET, HEAD, OPTIONS`                                                                                                                   |
| 同一 Key 当月已确认 5 次后再次请求真实模型                                           | `429 Too Many Requests`，包含到下个 UTC 月的 `Retry-After`，并通过 `Access-Control-Expose-Headers` 暴露该响应头                                                                      |
| 同一 Key 已占满 5 个待确认/已确认槽位，但仍有未失效回执                              | `503 Service Unavailable`，`Retry-After` 指向最早待确认回执的失效时间；避免并发请求越过硬上限                                                                                        |
| 选中的 R2 object 缺失                                                                | `500 Internal Server Error`                                                                                                                                                          |
| 真实模型或 Runtime 的 R2 长度漂移、已记录的 SHA-256 漂移                             | `500 Internal Server Error`；不返回对象内容，真实模型不会预留额度                                                                                                                    |

启用额度限制时，真实模型 `GET` 先查询已确认额度；已耗尽则直接返回 `429`，查询失败返回 `503`，两者都不读取 R2 对象。通过预检后才读取并校验对象，再原子预留回执，最终预留仍决定是否允许下载。该预检为允许下载的请求增加一次额度查询，不能提前判断待确认槽位是否占满。

通过额度预检后，选中的 R2 object 缺失或完整性元数据不符合共享清单时不会回退到其他对象；真实模型在此阶段不会预留额度。

## 鉴权

真实模型请求必须包含：

```http
Authorization: Bearer <64位十六进制token>
```

Model Worker 只在 token 格式正确且 `MODEL_KEYS` 中存在非空标记时返回真实模型。

以下方式不受支持：

```text
?key=<token>
?token=<token>
```

query-string key 不授权真实模型；按缺少 Bearer token 处理。只有有效的 `Authorization: Bearer` 可以选择真实模型对象。

无效或缺失 token 的处理由 `INVALID_KEY_MODE` 决定：

| 模式    | 行为                               |
| ------- | ---------------------------------- |
| `decoy` | 返回诱饵对象和 `200`，这是默认策略 |
| `error` | 返回 `403`                         |

## CORS

模型路由允许以下浏览器来源：

```text
https://hentaiverse.org
https://alt.hentaiverse.org
```

允许的来源会被原样回显，并设置 `Vary: Origin`。未知浏览器来源不会获得允许来源响应头。没有 `Origin` 的非浏览器请求按公开响应头处理。

精简 WASM 是公开内容寻址资源，使用：

```http
Access-Control-Allow-Origin: *
```

CORS 只控制浏览器读取权限，不构成真实模型鉴权。

## 事实来源与验证

路由与时序由 [request-router.ts](../../apps/model-worker/src/request-router.ts) 定义，响应头由 [model-response.ts](../../apps/model-worker/src/model-response.ts) 定义，Bearer 选择由 [model-access.ts](../../apps/model-worker/src/model-access.ts) 定义。`mise exec -- pnpm docs:check` 从这些源码提取事实并校验本页；修改协议还需运行 Worker 测试和相关客户端测试。文档校验不探测线上服务。
