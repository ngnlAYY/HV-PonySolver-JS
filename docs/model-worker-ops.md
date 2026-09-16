# Model Worker 运维手册

适用范围：配置生成、资产准备、发布后验收和保留持久状态的回滚。HTTP 响应以[接口契约](reference/model-worker-http.md)为准，客户端确认时序见[缓存策略](model-cache-strategy.md)。

运行时配置的权威来源是 [`apps/model-worker/wrangler.template.toml`](../apps/model-worker/wrangler.template.toml)，模型、ORT 模型和 WASM 的文件名、对象键、长度及 SHA-256 以 [`packages/shared/src/`](../packages/shared/src/) 为准。`apps/model-worker/wrangler.toml` 和 `.wrangler/` 是生成物，不手工维护。

## 配置与绑定

Model Worker 使用 Wrangler 模板生成部署配置：

```text
apps/model-worker/wrangler.template.toml
```

生成的 `apps/model-worker/wrangler.toml` 是本地或 CI 产物，不应手工维护为权威来源。

### 绑定

| 绑定                    | 类型                         | 作用                                                            |
| ----------------------- | ---------------------------- | --------------------------------------------------------------- |
| `MODEL_KEYS`            | Cloudflare KV                | 保存允许访问真实模型的 token 标记                               |
| `MODEL_BUCKET`          | Cloudflare R2                | 保存真实模型、诱饵模型和精简 WASM                               |
| `MODEL_DOWNLOAD_QUOTAS` | SQLite-backed Durable Object | 按规范化 Key 的 SHA-256 标识保存 UTC 月度确认次数与临时下载回执 |

### 运行时变量

| 变量                           | 作用                                         |
| ------------------------------ | -------------------------------------------- |
| `PUBLIC_MODEL_PATH`            | 旧版 ONNX 公开路径，默认 `/yolo26n-640.onnx` |
| `REAL_MODEL_OBJECT_KEY`        | 旧版真实 ONNX 的 R2 对象键，必填             |
| `DECOY_MODEL_OBJECT_KEY`       | 鉴权失败时使用的诱饵对象键，必填             |
| `PUBLIC_ORT_MODEL_PATH`        | 新版 ORT 公开路径，默认 `/yolo26n-640.ort`   |
| `REAL_ORT_MODEL_OBJECT_KEY`    | 新版真实 ORT 的 R2 对象键，默认来自共享契约  |
| `PUBLIC_RUNTIME_WASM_PATH`     | 精简 WASM 公开路径，默认来自共享契约         |
| `RUNTIME_WASM_OBJECT_KEY`      | 精简 WASM 的 R2 对象键，默认来自共享契约     |
| `PUBLIC_QUOTA_PATH`            | Key 月度下载次数查询路径，默认 `/quota`      |
| `INVALID_KEY_MODE`             | 无效 token 策略，只允许 `decoy` 或 `error`   |
| `MODEL_DOWNLOAD_QUOTA_ENABLED` | 是否启用每 Key 月度下载次数限制，默认 `true` |

### 生成 Wrangler 配置

```bash
MODEL_KEYS_KV_NAMESPACE_ID='<kv-namespace-id>' \
MODEL_BUCKET_NAME='<r2-bucket-name>' \
INVALID_KEY_MODE=decoy \
MODEL_DOWNLOAD_QUOTA_ENABLED=true \
pnpm --filter @hv-pony-solver/model-worker render-config

pnpm --filter @hv-pony-solver/model-worker exec node scripts/validate-wrangler-config.mjs
```

部署模式会拒绝测试占位值。`INVALID_KEY_MODE` 和 `MODEL_DOWNLOAD_QUOTA_ENABLED` 省略时使用项目默认策略。

## R2 上传清单

部署前至少确认以下对象存在：

| 对象          | R2 对象键                                                                                     | 是否公开 |
| ------------- | --------------------------------------------------------------------------------------------- | -------- |
| 旧版真实 ONNX | `REAL_MODEL_OBJECT_KEY` 配置值                                                                | 否       |
| 诱饵模型      | `DECOY_MODEL_OBJECT_KEY` 配置值                                                               | 否       |
| 新版真实 ORT  | `real/yolo26n-640.ort`                                                                        | 否       |
| 精简 WASM     | `runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm` | 是       |

上传精简 WASM 的示例：

```bash
pnpm --filter @hv-pony-solver/model-worker exec wrangler r2 object put \
  "<bucket-name>/runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm" \
  --file "other/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm"
```

Worker 总是检查 R2 对象的精确长度。Cloudflare R2 只有在上传时记录了 SHA-256 才会通过对象元数据暴露该值；为兼容既有对象，缺少该元数据不会单独拒绝响应，但只要存在就必须匹配共享清单。客户端仍会对实际下载字节执行精确长度和 SHA-256 校验，因此上传新对象时应保留 SHA-256 元数据，并在发布前用 canonical 文件复核实际内容。

## 本地发布入口

以下命令会实际部署，只有明确要求发布且 Cloudflare 身份已由受保护环境配置时执行。`run deploy` 会重新渲染配置，因此绑定与策略变量必须传给该命令本身；不要只在先前 render-config 的临时环境中设置。

```bash
MODEL_KEYS_KV_NAMESPACE_ID='<kv-namespace-id>' \
MODEL_BUCKET_NAME='<r2-bucket-name>' \
INVALID_KEY_MODE=decoy \
MODEL_DOWNLOAD_QUOTA_ENABLED=true \
mise exec -- pnpm --filter @hv-pony-solver/model-worker run deploy
```

必须保留 `run`，以调用工作区的部署脚本。部署模式拒绝测试占位值；`test-kv` 与 `test-bucket` 只用于离线验证。

## 无效 Key 模式

`INVALID_KEY_MODE` 控制缺少 Bearer token、token 格式错误或 KV 未命中的请求如何响应。可选值只有 `decoy` 和 `error`，默认值是 `decoy`。

- `decoy`：返回 decoy R2 模型，避免通过 HTTP 状态直接暴露 key 是否有效；缺点是异常流量仍会消耗 Worker、R2 读取和带宽。
- `error`：直接返回 `403 Forbidden`，适合出现异常流量、R2 成本需要优先控制，或需要快速区分未授权请求时临时启用。

建议默认保持 `decoy`。只有在明确需要降低异常请求成本或排障时，才通过手动部署 workflow 选择 `error`。

## 部署与分层验收

Model Worker 还依赖 `MODEL_DOWNLOAD_QUOTAS` SQLite-backed Durable Object。首次发布由 Wrangler 的 `new_sqlite_classes` 迁移创建 `ModelDownloadQuota`；它不需要环境变量或 GitHub secret。GitHub 手动部署 workflow 的 `enable_model_download_quota` 默认开启；关闭时真实模型 GET 不执行月度额度限制、不创建回执也不保存确认次数，客户端查询显示“无次数限制（模型下载次数限制未开启）”，意外发送且回执格式正确的 `POST /quota` 返回 `409` 而不是伪造确认成功，缺失或畸形回执仍返回 `400`。当前协议没有 cancel 端点；未确认的 reserve 由 Durable Object 的十分钟 TTL 清理。

配置渲染器会拒绝缺失或漂移的 `MODEL_DOWNLOAD_QUOTAS` Durable Object 绑定、`ModelDownloadQuota` 类名、`v1` migration tag 或 `new_sqlite_classes` 声明，防止回滚/部署配置静默丢失持久状态契约。

回执确认协议使用独立的 v2 状态键。首次部署该协议时，旧版在响应体到达客户端前产生、无法验证的计数不会迁入 v2；之后只保留客户端完成缓存后确认的使用次数。

### 1. 区分 dry-run 与实际发布

`.github/workflows/deploy-cloudflare-model-worker.yml` 是手动 workflow：

- Cloudflare secrets 完整时会渲染部署配置、执行 typecheck、测试和 Wrangler dry-run；`publish_model_worker=false` 时只跳过 `Deploy Worker`，workflow 总体绿色不代表线上已发布。
- Cloudflare secrets 不完整且 `publish_model_worker=false` 时会安全跳过配置渲染、Wrangler dry-run 和部署，但仍执行 typecheck 与测试。
- 整个 job 绑定受保护的 `production-model-worker` GitHub Environment，并在读取 secrets 前限定 `refs/heads/main`；非 `main` ref 的 job 会直接跳过。`publish_model_worker=true` 但 Cloudflare secrets 不完整时 fail closed；只有 ref、环境审批、发布意图和 secrets gate 全部通过时才会执行 `Deploy Worker`。
- 部署证据至少包括 workflow run URL、head SHA、`Deploy Worker` step 的 `success` 状态，以及日志中可获得的 Cloudflare deployment 标识或时间。不得把 secret 值复制到记录中。

触发生产发布前，确认目标 ref 是 `refs/heads/main`，并核对 `publish_model_worker`、`invalid_key_mode` 和 `enable_model_download_quota`。三个输入分别控制是否真实部署、无效 Key 返回诱饵还是 `403`、是否执行每 Key 月度 5 次限制；后两项不能从线上状态自动推断。`production-model-worker` Environment 应在 GitHub 设置中配置 required reviewers、只允许 `main` 部署并保存生产 secrets；不得从未验证分支临时部署。

### 2. 发布后公开契约检查

部署 workflow 不再自动运行 `check:deployment`，避免 GitHub 托管 runner 的边缘传播或安全策略误报把已成功的 Wrangler 部署标记为失败。workflow 发布成功只证明部署命令完成；需要线上 HTTP 证据时，由操作者在边缘传播后手动运行检查器，并使用不含凭据和用户数据的 probe ID。检查器会对以下两个 Origin 分别验证：

- `https://hentaiverse.org`
- `https://alt.hentaiverse.org`

检查器对旧版 ONNX 和当前 ORT 路由发送不含 `Authorization` 的 `OPTIONS` 和 `HEAD` 请求，并对公开精简 WASM 发送 `HEAD`。`HEAD` 明确请求 identity 编码，避免边缘压缩移除原始对象的 `Content-Length`。它不读取模型 body，也不接收 Cloudflare credential、KV namespace、R2 bucket 或模型 Key。每个请求默认在 10 秒后 abort；默认最多尝试 5 次，每次失败后等待 7.5 秒，为边缘传播提供 30 秒重试窗口，同时防止未响应的 edge 永久阻塞手动检查。

公开契约必须满足：

| 请求                        | 预期                                                                                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPTIONS`                   | `204`；`Access-Control-Allow-Origin` 精确回显请求 Origin；`Access-Control-Allow-Methods` 精确为 `GET`、`HEAD`、`OPTIONS`；`Access-Control-Allow-Headers` 精确为 `Authorization`；`Cache-Control: no-store`；`Vary` 包含 `Origin` |
| 无 Key `HEAD`，`decoy` 模式 | `200`；精确回显 Origin；`Cache-Control: no-store`；`Vary` 包含 `Origin`                                                                                                                                                          |
| 无 Key `HEAD`，`error` 模式 | `403`；精确回显 Origin；`Cache-Control: no-store`；`Vary` 包含 `Origin`                                                                                                                                                          |
| 精简 WASM `HEAD`            | `200`；`Access-Control-Allow-Origin: *`；`Content-Type: application/wasm`；一年 immutable 缓存；长度匹配共享契约；存在 ETag                                                                                                      |

必要时可在本地手动运行同一检查；先使用 `mise exec -- pnpm install --frozen-lockfile` 准备仓库依赖。`MODEL_WORKER_PROBE_ID` 只能使用不含凭据和用户数据的唯一标识：

```bash
MODEL_WORKER_URL=https://models.ngnl.host/yolo26n-640.onnx \
MODEL_WORKER_ORT_URL=https://models.ngnl.host/yolo26n-640.ort \
MODEL_WORKER_RUNTIME_WASM_URL=https://models.ngnl.host/runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm \
MODEL_WORKER_RUNTIME_WASM_BYTE_LENGTH=1267937 \
MODEL_WORKER_INVALID_KEY_MODE=decoy \
MODEL_WORKER_PROBE_ID=manual-$(date +%s) \
mise exec -- pnpm --filter @hv-pony-solver/model-worker check:deployment
```

无 Key `HEAD 200` 在 `decoy` 模式只证明 decoy 路径正常，不证明真实模型授权或 artifact 正确。ORT 和 WASM 探测会发现新路由未部署、公开 WASM 对象缺失或对象长度漂移，但不读取并重新哈希真实 ORT 模型内容。

Worker 在响应真实 ONNX、真实 ORT 和公开 WASM 前，强制要求 R2 对象长度与共享清单完全一致；若 R2 对象记录了 SHA-256 元数据，该值也必须匹配。R2 对既有上传可能不暴露 SHA-256，因此缺少该元数据本身暂不拒绝响应；浏览器客户端仍会对实际下载字节执行精确长度和 SHA-256 校验。新上传应尽量保留 SHA-256 元数据，以便 Worker 在发送 body 或预留额度前额外失败关闭。

### 3. 客户端 Key、额度与下载验收

公开契约通过后，由用户在 Userscript 菜单或扩展设置页中重新验证已知 Key，再验证保存后的额度查询和普通下载。Key 只保留在用户本地，不得放入聊天、URL、query string、CLI 参数、GitHub log、测试 fixture 或任务记录。

浏览器请求必须继续使用标准 `fetch` 和 `Authorization: Bearer <key>`。不要改用 `GM_xmlhttpRequest` / `GM.xmlHttpRequest` 绕过 CORS，也不要关闭 byteLength 或 SHA-256 完整性校验。

Key 验证使用不计额度的 `HEAD` 探测，不消耗下载次数。客户端的次数查询使用已保存 Key 调用只读 `GET /quota`，返回本月上限、已确认使用和剩余次数；关闭限制时返回 `enabled=false`，客户端不得显示虚构的 `0/5`，且格式正确的确认请求以 `409` 明确拒绝（缺失或畸形回执为 `400`）。真实模型 GET 仅预留一个十分钟有效的回执；客户端完整读取、校验并完成 IndexedDB 缓存后，才调用 `POST /quota` 确认并计数。确认接口按回执幂等，缓存未完成或回执失效均不计数；收到 `429` 才表示该 Key 当月已经确认使用 5 次。已确认与待确认槽位合计占满但仍有回执未失效时返回 `503`，它不是月额度已经确认用完。

扩展远程模型版提供“验证并保存”“查询下载次数”“下载模型”和“清除 Key”。有效模型缓存命中不会再次下载或计次。设置页保留 Worker 返回的 HTTP/协议错误和浏览器 Port 错误；只有额度查询会在瞬时 Port 断开后重连一次，第二次失败原样呈现。看到“连接已断开”说明扩展内部传输没有收到 Host 响应，不能据此判定 KV、R2 或 Durable Object 已失败。

### 4. 次级故障分流

按首次失败证据逐层定位，不要同时修改多层配置：

1. `OPTIONS 405`、`Allow: GET, HEAD` 或旧 public cache header：先检查部署 ref、Cloudflare route 和边缘传播；此时 Key 尚未到达 KV，不应先排查 Key 内容。
2. `OPTIONS` 正确但无效/有效 Key收到 `403`：核对 deployed `INVALID_KEY_MODE`、Worker 的 KV binding target 与相应 entry；不得输出 entry 的 key/value。
3. Worker 返回通用 `500`：先核对目标 R2 object 是否存在、对象长度是否匹配共享清单，以及已记录的 SHA-256 元数据是否漂移；真实模型在此阶段不会预留额度。
4. HTTP `200` 后出现 byteLength 或 SHA-256 错误：对象可能没有可供 Worker 预检的 SHA-256 元数据；核对 real/decoy R2 object 选择，并在受控环境中用 `packages/shared/src/model.ts`（旧版 ONNX）或 `packages/shared/src/ort-model.ts`（当前 ORT）的 canonical manifest 校验真实 artifact。
5. 有效 Key 收到 `429`：确认 `Retry-After`、UTC 月边界和 Durable Object 绑定；不要把它改成 decoy 或放宽为 KV 非原子计数。
6. 有效 Key 收到 `503`：先区分额度存储不可用与待确认槽位占满；后者等待响应给出的 `Retry-After`，不要手工增加已用次数。
7. 仍为 `Failed to fetch`：收集浏览器 Network 面板中不含 secret 的 CORS、DNS、TLS、status 与 CF-Ray 信息。
8. 下载和完整性校验通过但缓存失败：单独排查 IndexedDB；后端不应收到成功确认，不改变授权链路或完整性要求。
9. 扩展只显示额度/下载连接断开：检查扩展后台是否重启、Port 错误内容和浏览器控制台；额度查询已自动重连一次，不要把重复点击当作后端重试证据。

## 发布后失败与回滚

发布后 checker 失败意味着“部署命令已经执行，但公开验收失败”，不能解读为“生产没有变化”。workflow 故意不自动回滚，也不自动进行第二次部署。

处理顺序：

1. 保存 run URL、head SHA、`Deploy Worker` step 状态、deployment 标识/时间，以及不含 Key、无 body 的失败 method、Origin、status/header 差异。
2. 判断是传播延迟、checker 契约误报、route 漂移，还是新 Worker 本身有问题。
3. 如果需要回滚，部署一个仍保留 `ModelDownloadQuota` 类、`MODEL_DOWNLOAD_QUOTAS` 绑定和 SQLite 迁移的前向修复版本；不要部署删除这些资源的旧配置。
4. 回滚后重新运行公开 OPTIONS/HEAD 检查。

Worker code rollback 不会自动恢复或改变 KV token、R2 object、Durable Object 配额状态和 Userscript 构建产物。若公开 CORS 契约正确但真实 Key仍失败，不应回滚正确的 OPTIONS/CORS 修复；应继续按 KV、Durable Object、R2 和 manifest 分层诊断。

若只是 `error` 模式误伤正常用户，可在确认后重新触发 workflow 并把 `invalid_key_mode` 改回 `decoy`。这仍是一次新的生产部署，不能由 checker 自动执行。

## 待办运维项

`HEAD` 用于客户端验证 Key，不计额度，但真实模型和诱饵响应的长度、元数据与耗时可能不同；`decoy` 只避免用 HTTP 状态直接区分授权结果，不能保证无法探测 Key 是否有效。以下事项用于缩小该探测面，尚未执行：

- 生成与真实模型相同字节长度的诱饵对象并上传 R2，拉平 decoy 响应的 `Content-Length`，缩小通过 `HEAD` 元数据区分有效/无效 Key 的空间。
- 将 KV 中历史保留的大写/混合大小写 token 变体迁移为单一 canonical 小写键，迁移完成前 Worker 需要继续按大小写变体回退查询。
- 评估 decoy `GET` 是否补充一次等价的 Durable Object 往返以拉平有效与无效 Key 的计时差；该改动会为未授权请求增加 DO 调用成本，留作决策项。

## Cloudflare rate limit 建议

- 在 Cloudflare Dashboard 针对 `models.ngnl.host/yolo26n-640.onnx` 配置按 IP 的速率限制规则。
- 先使用日志或模拟模式观察命中情况，再切换到阻断模式。
- 优先观察这些指标：Worker invocation、R2 Class B 读请求、R2 带宽、`403` 响应数量、decoy 命中比例。
- 每 Key 月度额度由 Durable Object 强一致事务执行；Dashboard 的按 IP 速率限制只能作为额外防护，不能替代业务额度。
- 如果启用 `error` 模式后正常用户失败率升高，应在明确确认后回到 `decoy`，并检查 token 分发链路。
