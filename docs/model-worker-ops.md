# Model Worker Operations

## Invalid key mode

`INVALID_KEY_MODE` 控制缺少 Bearer token、token 格式错误或 KV 未命中的请求如何响应。可选值只有 `decoy` 和 `error`，默认值是 `decoy`。

- `decoy`：返回 decoy R2 模型，避免通过 HTTP 状态直接暴露 key 是否有效；缺点是异常流量仍会消耗 Worker、R2 读取和带宽。
- `error`：直接返回 `403 Forbidden`，适合出现异常流量、R2 成本需要优先控制，或需要快速区分未授权请求时临时启用。

建议默认保持 `decoy`。只有在明确需要降低异常请求成本或排障时，才通过手动部署 workflow 选择 `error`。

## Cloudflare rate limit 建议

- 在 Cloudflare Dashboard 针对 `models.ngnl.host/yolo26n-640.onnx` 配置按 IP 的速率限制规则。
- 先使用日志或模拟模式观察命中情况，再切换到阻断模式。
- 优先观察这些指标：Worker invocation、R2 Class B 读请求、R2 带宽、`403` 响应数量、decoy 命中比例。
- 如果启用 `error` 模式后正常用户失败率升高，应立即回滚到 `decoy` 并检查 token 分发链路。

## 变更与回滚

1. 打开 GitHub Actions 的 `Deploy Cloudflare Model Worker` workflow。
2. 手动触发 workflow，保持 `publish_model_worker=true`。
3. 通过 `invalid_key_mode` 选择 `decoy` 或 `error`。
4. workflow 会使用同一输入渲染 Wrangler 配置、执行 dry-run，并在发布时重新渲染配置。

回滚不需要修改 KV token、R2 object 或 userscript 构建产物。若 `error` 模式误伤正常用户，重新触发部署并把 `invalid_key_mode` 改回 `decoy` 即可。
