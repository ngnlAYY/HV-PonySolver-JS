# Model Cache Strategy

## 当前决策

Model Worker 响应继续保持 `Cache-Control: no-store`。

## 原因

- 模型访问由 `Authorization: Bearer` 控制。
- 当前公开路径 `/yolo26n-640.onnx` 不包含不可变模型版本。
- 在没有明确 token-aware cache 规则前，共享缓存可能扩大授权边界。
- userscript 侧已经通过 IndexedDB 与 `MODEL_INTEGRITY` 做本地缓存和完整性校验，Worker 侧缓存收益需要先证明不会削弱授权与回滚能力。
- 月度额度耗尽的 `429` 也必须保持 `no-store`，只通过 `Retry-After` 告知下次 UTC 月可重试时间，避免共享缓存污染其他 Key。

## 未来可选方案

只有同时满足以下条件，才评估放宽 Worker 响应缓存：

1. 模型 URL 包含不可变版本，例如 `/models/yolo26n-640-2026-05-14.onnx`。
2. Worker 明确设置 `Vary: Authorization, Origin`，或完全禁止共享缓存只允许私有缓存。
3. 发布脚本生成模型 version、byteLength、sha256 和 URL 的对应关系。
4. 回滚方案保留旧版本 R2 object，并能让 userscript 继续下载旧版本。
5. decoy 模型与真实模型的缓存规则分别评估，避免通过缓存命中行为泄露授权状态。

## 变更前验证

改变 Worker 响应缓存策略前至少运行：

```bash
corepack pnpm --filter @hv-pony-solver/model-worker test
```

并手动验证以下场景：

- 授权 token 返回真实模型。
- 无 token、格式错误 token、KV 未命中 token 在 `INVALID_KEY_MODE=decoy` 下返回 decoy 模型。
- 无 token、格式错误 token、KV 未命中 token 在 `INVALID_KEY_MODE=error` 下返回 `403 Forbidden`。
- `HEAD` 响应不返回 body，且 headers 与 `GET` 语义一致。
- `OPTIONS` preflight 响应允许 `Authorization` header。
- 未知 `Origin` 不授予 CORS。
- 版本回滚后，旧 URL 与新 URL 的缓存不会互相污染。
- 第 6 次真实模型 `GET` 返回不可缓存的 `429`，且浏览器可读取 `Retry-After`。
