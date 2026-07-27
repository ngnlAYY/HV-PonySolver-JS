# Error Handling

## Overview

Model Worker 不使用自定义 Error hierarchy 或 JSON error envelope。预期 HTTP branches 显式返回固定纯文本/模型 response；未处理异常在最外层隐藏为通用 500。任何错误路径都必须保持 CORS、`no-store` 与安全 headers。

## HTTP Matrix

| Condition                                    | Response                                               |
| -------------------------------------------- | ------------------------------------------------------ |
| Pathname 不匹配                              | `404 Not Found`                                        |
| 模型路径 `OPTIONS`                           | `204` preflight                                        |
| 非 `GET`/`HEAD`/`OPTIONS`                    | `405 Method Not Allowed` + `Allow: GET, HEAD, OPTIONS` |
| Invalid/missing/KV-miss token，`decoy` mode  | `200` decoy model                                      |
| Invalid/missing/KV-miss token，`error` mode  | `403 Forbidden`                                        |
| Selected R2 object 不存在                    | `500 Internal Server Error`                            |
| Invalid env/binding 或未处理 KV/R2 exception | `500 Internal Server Error`                            |

Decoy `200` 是有意策略，不是吞错。不要统一改成 401/403。

## Runtime Boundary

`apps/model-worker/src/index.ts` 捕获未处理异常，但不回传异常 message、stack、binding、object key 或 token，只调用 `textResponse(request, 'Internal Server Error', 500)`。

`apps/model-worker/src/env.ts` 在入口归一化：

- `MODEL_KEYS` / `MODEL_BUCKET` 必须有 callable `get`。
- real/decoy object key 必须包含非空白字符；validator 返回原字符串，不自动 trim 后使用。
- `INVALID_KEY_MODE` trim/lowercase，只接受 `decoy`/`error`；missing/empty 默认 `decoy`。
- `PUBLIC_MODEL_PATH` 仅在 `undefined` 时使用 Shared default；当前没有通用 trim/非空校验。

不要声称所有 env strings 都被 trim。

## Response Safety

`apps/model-worker/src/model-response.ts` 统一：

- text/model/preflight 使用 `Cache-Control: no-store`；
- 添加 `X-Content-Type-Options: nosniff`；
- 维护 `Vary: Origin`；
- 白名单 Origin 精确回显；无 Origin 时为 `*`；未知 Origin 不获得 ACAO。

错误响应不得预设 public cache header 绕过 `textResponse` 默认值。

## Forbidden / Common Mistakes

- 把 exception message/stack、token、KV/R2 detail 返回给 client。
- 发明 JSON error body、error code 或 exception base class。
- 忽略 `INVALID_KEY_MODE`，把所有 invalid Key变成同一 status。
- R2 miss 时切换 real/decoy。
- 错误响应遗漏 `no-store`、CORS、`Vary: Origin` 或 `nosniff`。
- 给未知 Origin 设置 `*`；只有没有 Origin header 的请求使用 `*`。
- 为“方便排障”关闭浏览器 CORS 或客户端完整性校验。

## Validation

```bash
corepack pnpm --filter @hv-pony-solver/model-worker exec vitest run test/env.test.ts test/index.test.ts
corepack pnpm --filter @hv-pony-solver/model-worker test
corepack pnpm docs:check
```
