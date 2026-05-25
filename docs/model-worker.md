# Model Worker

`apps/model-worker` 部署到 Cloudflare Workers，负责按授权策略分发 ONNX 模型。

## 请求路径与方法

- 仅处理 `PUBLIC_MODEL_PATH` 对应路径（默认 `/yolo26n-640.onnx`）。
- 仅允许 `GET` 与 `HEAD`。
- 其他路径返回 `404 Not Found`。
- 非 `GET`/`HEAD` 方法返回 `405 Method Not Allowed`，并带 `Allow: GET, HEAD`。

## key query 与 KV 授权

Worker 读取 `key` query 参数并做 token 校验：

- `key` 必须是 64 位十六进制字符串。
- 合法 key 会用作 KV key 查询 `MODEL_KEYS` 绑定。
- KV 命中（值非 `null`）=> 授权访问真实模型。
- key 缺失、格式不合法、或 KV 未命中 => 进入无效 key 分支。

## 模型对象与访问决策

运行时环境变量：

- `PUBLIC_MODEL_PATH`：公开模型路径（可选，默认应与 `packages/shared` 的 `DEFAULT_PUBLIC_MODEL_PATH` 一致）
- `REAL_MODEL_OBJECT_KEY`：真实模型 R2 object key（必填，应与 `MODEL_FILENAME` 对应）
- `DECOY_MODEL_OBJECT_KEY`：decoy 模型 R2 object key（必填，应与 `MODEL_FILENAME` 对应）
- `INVALID_KEY_MODE`：无效 key 策略（`decoy` 或 `error`）

`packages/shared` 中的 `MODEL_VERSION` 与 `MODEL_INTEGRITY` 是模型版本和完整性元数据的一致性来源；Worker 的 R2 对象内容必须与该 manifest 对应。

无效 key 决策：

- `INVALID_KEY_MODE=decoy`：返回 decoy 模型。
- `INVALID_KEY_MODE=error`：返回 `403 Forbidden`。

## HEAD/GET 响应行为

- `GET`：返回模型二进制 body。
- `HEAD`：返回相同响应头，不返回 body。
- 成功模型响应使用 `application/octet-stream`。
- 响应包含 `Content-Disposition: inline; filename="yolo26n-640.onnx"` 与缓存头。

## CORS 策略

1. **无 `Origin` 请求头**：允许直接下载（返回可用的 `Access-Control-Allow-Origin`）。
2. `Origin` 为 `https://hentaiverse.org` 或 `https://alt.hentaiverse.org`：授予 CORS。
3. 其他 `Origin`：不授予 CORS（不回写允许该源的 `Access-Control-Allow-Origin`）。

## Token handling

Model access tokens are 64-character hexadecimal strings stored as KV keys. They authorize model distribution but are still visible to users who install a userscript containing or storing the token. Treat tokens as revocable access grants, not as permanent secrets. Rotate tokens if they appear in logs, screenshots, support messages, or public builds.

## 本地验证示例

```bash
MODEL_KEYS_KV_NAMESPACE_ID=test-kv MODEL_BUCKET_NAME=test-bucket pnpm --filter @hv-pony-solver/model-worker render-config
pnpm --filter @hv-pony-solver/model-worker typecheck
pnpm --filter @hv-pony-solver/model-worker test
```

部署命令：

```bash
pnpm --filter @hv-pony-solver/model-worker run deploy
```
