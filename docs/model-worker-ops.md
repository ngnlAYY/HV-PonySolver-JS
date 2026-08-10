# Model Worker Operations

## Invalid key mode

`INVALID_KEY_MODE` 控制缺少 Bearer token、token 格式错误或 KV 未命中的请求如何响应。可选值只有 `decoy` 和 `error`，默认值是 `decoy`。

- `decoy`：返回 decoy R2 模型，避免通过 HTTP 状态直接暴露 key 是否有效；缺点是异常流量仍会消耗 Worker、R2 读取和带宽。
- `error`：直接返回 `403 Forbidden`，适合出现异常流量、R2 成本需要优先控制，或需要快速区分未授权请求时临时启用。

建议默认保持 `decoy`。只有在明确需要降低异常请求成本或排障时，才通过手动部署 workflow 选择 `error`。

## 部署与分层验收

### 1. 区分 dry-run 与实际发布

`.github/workflows/deploy-cloudflare-model-worker.yml` 是手动 workflow：

- `publish_model_worker=false` 时可以完成配置渲染、测试和 Wrangler dry-run，但 `Deploy Worker` 与发布后检查都会跳过；workflow 总体绿色不代表线上已发布。
- 只有 `publish_model_worker=true` 且 Cloudflare secrets gate 通过时，才会执行 `Deploy Worker`。
- 部署证据至少包括 workflow run URL、head SHA、`Deploy Worker` step 的 `success` 状态，以及日志中可获得的 Cloudflare deployment 标识或时间。不得把 secret 值复制到记录中。

触发生产发布前，确认目标 ref、`publish_model_worker` 和 `invalid_key_mode`。发布时使用仓库中受审查的 ref，不从未验证分支临时部署。

### 2. 发布后公开契约检查

实际部署完成后，workflow 自动运行 `check:deployment`。检查器使用 GitHub run/attempt 组成非秘密 probe ID，对以下两个 Origin 分别验证：

- `https://hentaiverse.org`
- `https://alt.hentaiverse.org`

检查器对旧版 ONNX 和当前 ORT 路由发送不含 `Authorization` 的 `OPTIONS` 和 `HEAD` 请求，并对公开精简 WASM 发送 `HEAD`。它不读取模型 body，也不接收 Cloudflare credential、KV namespace、R2 bucket 或模型 Key。每个请求默认在 10 秒后 abort；默认最多尝试 13 次，每次失败后等待 5 秒，为 Cloudflare 边缘传播提供 60 秒重试窗口，同时防止未响应的 edge 永久阻塞 workflow。

公开契约必须满足：

| 请求                        | 预期                                                                                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPTIONS`                   | `204`；`Access-Control-Allow-Origin` 精确回显请求 Origin；`Access-Control-Allow-Methods` 精确为 `GET`、`HEAD`、`OPTIONS`；`Access-Control-Allow-Headers` 精确为 `Authorization`；`Cache-Control: no-store`；`Vary` 包含 `Origin` |
| 无 Key `HEAD`，`decoy` 模式 | `200`；精确回显 Origin；`Cache-Control: no-store`；`Vary` 包含 `Origin`                                                                                                                                                          |
| 无 Key `HEAD`，`error` 模式 | `403`；精确回显 Origin；`Cache-Control: no-store`；`Vary` 包含 `Origin`                                                                                                                                                          |
| 精简 WASM `HEAD`             | `200`；`Access-Control-Allow-Origin: *`；`Content-Type: application/wasm`；一年 immutable 缓存；长度匹配共享契约；存在 ETag                                                                                                    |

必要时可在本地手动运行同一检查；`MODEL_WORKER_PROBE_ID` 只能使用不含凭据和用户数据的唯一标识：

```bash
MODEL_WORKER_URL=https://models.ngnl.host/yolo26n-640.onnx \
MODEL_WORKER_ORT_URL=https://models.ngnl.host/yolo26n-640.ort \
MODEL_WORKER_RUNTIME_WASM_URL=https://models.ngnl.host/runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm \
MODEL_WORKER_RUNTIME_WASM_BYTE_LENGTH=1267937 \
MODEL_WORKER_INVALID_KEY_MODE=decoy \
MODEL_WORKER_PROBE_ID=<probe-id> \
pnpm --filter @hv-pony-solver/model-worker check:deployment
```

无 Key `HEAD 200` 在 `decoy` 模式只证明 decoy 路径正常，不证明真实模型授权或 artifact 正确。ORT 和 WASM 探测会发现新路由未部署或公开 WASM 对象缺失，但仍不证明真实 ORT 模型内容正确。

### 3. 用户本地 Key 验证

公开契约通过后，由用户在 Userscript 菜单中重新验证已知 Key，再验证保存后的普通下载。Key 只保留在用户本地，不得放入聊天、URL、query string、CLI 参数、GitHub log、测试 fixture 或任务记录。

浏览器请求必须继续使用标准 `fetch` 和 `Authorization: Bearer <key>`。不要改用 `GM_xmlhttpRequest` / `GM.xmlHttpRequest` 绕过 CORS，也不要关闭 byteLength 或 SHA-256 完整性校验。

### 4. 次级故障分流

按首次失败证据逐层定位，不要同时修改多层配置：

1. `OPTIONS 405`、`Allow: GET, HEAD` 或旧 public cache header：先检查部署 ref、Cloudflare route 和边缘传播；此时 Key 尚未到达 KV，不应先排查 Key 内容。
2. `OPTIONS` 正确但无效/有效 Key收到 `403`：核对 deployed `INVALID_KEY_MODE`、Worker 的 KV binding target 与相应 entry；不得输出 entry 的 key/value。
3. HTTP `200` 后出现 byteLength 或 SHA-256 错误：核对 real/decoy R2 object 选择，并在受控环境中用 `packages/shared/src/model.ts` 的 canonical manifest 校验真实 artifact。
4. 仍为 `Failed to fetch`：收集浏览器 Network 面板中不含 secret 的 CORS、DNS、TLS、status 与 CF-Ray 信息。
5. 下载和完整性校验通过但缓存失败：单独排查 IndexedDB，不改变授权链路或完整性要求。

## 发布后失败与回滚

发布后 checker 失败意味着“部署命令已经执行，但公开验收失败”，不能解读为“生产没有变化”。workflow 故意不自动回滚，也不自动进行第二次部署。

处理顺序：

1. 保存 run URL、head SHA、`Deploy Worker` step 状态、deployment 标识/时间，以及不含 Key、无 body 的失败 method、Origin、status/header 差异。
2. 判断是传播延迟、checker 契约误报、route 漂移，还是新 Worker 本身有问题。
3. 如果需要回滚，由操作者在确认目标 deployment 后使用 Cloudflare deployment history 回到已知版本，或重新部署已知 git commit。
4. 回滚后重新运行公开 OPTIONS/HEAD 检查。

Worker code rollback 不会自动恢复或改变 KV token、R2 object 和 Userscript 构建产物。若公开 CORS 契约正确但真实 Key仍失败，不应回滚正确的 OPTIONS/CORS 修复；应继续按 KV、R2 和 manifest 分层诊断。

若只是 `error` 模式误伤正常用户，可在确认后重新触发 workflow 并把 `invalid_key_mode` 改回 `decoy`。这仍是一次新的生产部署，不能由 checker 自动执行。

## Cloudflare rate limit 建议

- 在 Cloudflare Dashboard 针对 `models.ngnl.host/yolo26n-640.onnx` 配置按 IP 的速率限制规则。
- 先使用日志或模拟模式观察命中情况，再切换到阻断模式。
- 优先观察这些指标：Worker invocation、R2 Class B 读请求、R2 带宽、`403` 响应数量、decoy 命中比例。
- 如果启用 `error` 模式后正常用户失败率升高，应在明确确认后回到 `decoy`，并检查 token 分发链路。
