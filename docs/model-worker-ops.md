# Model Worker 运维手册

本页负责配置、R2 准备、发布验收和保留持久状态的回滚。协议见 [HTTP 参考](reference/model-worker-http.md)，字节身份见 [Runtime 资产](onnx-runtime.md)，客户端事务见[缓存策略](model-cache-strategy.md)。以下命令均从仓库根目录运行，先按[验证手册](development/verification.md)准备 mise 与依赖。

## 配置与绑定

[wrangler.template.toml](../apps/model-worker/wrangler.template.toml) 是权威配置；`apps/model-worker/wrangler.toml`、`.wrangler/` 是生成物。覆盖已有本地配置前，在仓库外备份并在验证后恢复。

### 绑定

| 绑定                    | 类型与职责                                                         |
| ----------------------- | ------------------------------------------------------------------ |
| `MODEL_KEYS`            | KV，保存真实模型 Key 的非空白授权标记                              |
| `MODEL_BUCKET`          | R2，保存真实/诱饵模型与精简 WASM                                   |
| `MODEL_DOWNLOAD_QUOTAS` | SQLite-backed DO，按规范化 Key 的 SHA-256 隔离已确认次数与临时回执 |

### 运行时变量

| 变量                                                  | 含义与默认值                             |
| ----------------------------------------------------- | ---------------------------------------- |
| `PUBLIC_MODEL_PATH`                                   | 旧 ONNX 路径，`/yolo26n-640.onnx`        |
| `REAL_MODEL_OBJECT_KEY`、`DECOY_MODEL_OBJECT_KEY`     | 真实 ONNX 与诱饵对象键，必填             |
| `PUBLIC_ORT_MODEL_PATH`、`REAL_ORT_MODEL_OBJECT_KEY`  | ORT 路径/对象键，默认取 shared           |
| `PUBLIC_RUNTIME_WASM_PATH`、`RUNTIME_WASM_OBJECT_KEY` | 内容寻址 WASM 路径/对象键，默认取 shared |
| `PUBLIC_QUOTA_PATH`                                   | 查询与确认路径，`/quota`                 |
| `INVALID_KEY_MODE`                                    | `decoy`（默认）或 `error`                |
| `MODEL_DOWNLOAD_QUOTA_ENABLED`                        | `true`（默认）或 `false`                 |

公开路径必须已经是 URL 的规范 pathname：禁止点段及编码点段、原始空格/Unicode、控制字符和 `//` 网络路径；有效百分号编码原样保留，不自动改写大小写或路由。渲染、部署校验和 Worker 运行时共用同一规则，并把省略变量的默认路径纳入唯一性检查。无效配置在路由匹配前失败，HTTP 仅返回通用 500，不回显配置值。

### 生成 Wrangler 配置

绑定值由受保护环境提供；下例中的占位符需替换为本地受保护变量。部署模式拒绝测试占位值，`test-kv`/`test-bucket` 只用于离线验证。

```bash
HV_PONY_SOLVER_RENDER_ENV=deploy \
MODEL_KEYS_KV_NAMESPACE_ID='<kv-namespace-id>' \
MODEL_BUCKET_NAME='<r2-bucket-name>' \
INVALID_KEY_MODE=decoy \
MODEL_DOWNLOAD_QUOTA_ENABLED=true \
mise exec -- pnpm --filter @hv-pony-solver/model-worker render-config

mise exec -- pnpm --filter @hv-pony-solver/model-worker exec node scripts/validate-wrangler-config.mjs
```

两个策略变量省略时使用上表默认值；其他路由/对象键通过模板维护，不手工修改生成文件。

## R2 上传清单

| 对象          | R2 对象键                                                                                     | 访问                         |
| ------------- | --------------------------------------------------------------------------------------------- | ---------------------------- |
| 旧版真实 ONNX | `REAL_MODEL_OBJECT_KEY`                                                                       | Key 鉴权                     |
| 诱饵模型      | `DECOY_MODEL_OBJECT_KEY`                                                                      | 模型无效 Key 且 `decoy` 模式 |
| 当前真实 ORT  | `real/yolo26n-640.ort`                                                                        | Key 鉴权                     |
| 精简 WASM     | `runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm` | 公开                         |

核对 [canonical 长度与 SHA-256](onnx-runtime.md#r2-资产)，确认上传授权与 Cloudflare 身份后，在已激活 mise 的 shell 上传精简 WASM：

```bash
pnpm --filter @hv-pony-solver/model-worker exec wrangler r2 object put \
  "<bucket-name>/runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm" \
  --remote \
  --file "../../other/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm"
```

`--filter @hv-pony-solver/model-worker` 让 `exec` 在 `apps/model-worker` 执行，所以文件用 `../../other/` 定位。`--remote` 必须保留，省略时写本地 R2，不能更新线上资产。

Worker 强制检查 R2 长度，已有 SHA-256 元数据也必须匹配；缺该元数据兼容旧对象。新上传应保留 SHA-256 元数据，并用 canonical 文件复核内容；客户端始终另校验实际下载字节。

## 本地发布入口

以下命令实际部署，仅在明确授权且受保护环境已配置 Cloudflare 身份时执行。部署脚本重新渲染配置，绑定与策略变量必须传给本次命令：

```bash
MODEL_KEYS_KV_NAMESPACE_ID='<kv-namespace-id>' \
MODEL_BUCKET_NAME='<r2-bucket-name>' \
INVALID_KEY_MODE=decoy \
MODEL_DOWNLOAD_QUOTA_ENABLED=true \
mise exec -- pnpm --filter @hv-pony-solver/model-worker run deploy
```

必须保留 `run`，以执行工作区脚本；它启用部署模式校验，拒绝测试占位绑定。

## 无效 Key 模式

默认 `decoy` 返回诱饵，隐藏直接的 HTTP 授权状态差异，但仍消耗 Worker/R2/带宽，长度和耗时也可能被区分。`error` 直接返回 403，适合明确需要降低异常流量成本或区分未授权请求的部署。该策略只影响模型路由，额度接口始终要求真实 Key。

## 部署与分层验收

Wrangler 以 `ModelDownloadQuota`、`MODEL_DOWNLOAD_QUOTAS`、`v1` migration tag 和 `new_sqlite_classes` 创建并保留 SQLite-backed DO；不需要单独 secret。渲染器会拒绝这些声明缺失或漂移。v2 确认协议不迁移旧版无法验证的提前计数，后续只累计成功确认；内部状态详见[服务架构](architecture/model-service.md)。

关闭额度后，真实 GET 不预留或计次，客户端显示“无次数限制”；合法确认返回 409，畸形回执返回 400。协议没有 cancel 端点，未确认回执十分钟后失效，本地取消不回滚服务端确认。

### 1. 区分 dry-run 与实际发布

手动工作流 `.github/workflows/deploy-cloudflare-model-worker.yml` 在读取生产 secrets 前把整个 job 限定到 `refs/heads/main`，并绑定 `production-model-worker` Environment：

- Cloudflare secrets 完整时渲染配置、执行 typecheck、测试和 Wrangler dry-run；`publish_model_worker=false` 只跳过实际部署，绿色运行不代表上线。
- Cloudflare secrets 不完整且 `publish_model_worker=false` 时会安全跳过配置渲染、Wrangler dry-run 和部署，但仍执行 typecheck 与测试。
- `publish_model_worker=true` 且 secrets 不完整时 fail closed；只有 main、环境审批、发布意图和 secrets gate 都通过才执行 `Deploy Worker`。

生产环境需配置 required reviewers、main 部署限制，以及 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`、`MODEL_KEYS_KV_NAMESPACE_ID`、`MODEL_BUCKET_NAME` 四个 secrets。触发前核对三个输入：`publish_model_worker`、`invalid_key_mode`、`enable_model_download_quota`（默认 true，每 Key 月度 5 次）；不能从线上状态推断输入。

发布证据保留 run URL、head SHA、`Deploy Worker` step 的 success 和可获得的 deployment 标识/时间，不记录 secret 值。完整 CI 分工见[发布手册](development/releases.md)。

### 2. 发布后公开契约检查

工作流不自动运行 `check:deployment`，避免边缘传播或 runner 安全策略误报掩盖真实部署结果。操作者在传播后运行下面的无凭据探测；probe ID 不得含用户数据或秘密。

```bash
MODEL_WORKER_URL=https://models.ngnl.host/yolo26n-640.onnx \
MODEL_WORKER_ORT_URL=https://models.ngnl.host/yolo26n-640.ort \
MODEL_WORKER_RUNTIME_WASM_URL=https://models.ngnl.host/runtime/ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm \
MODEL_WORKER_RUNTIME_WASM_BYTE_LENGTH=1267937 \
MODEL_WORKER_INVALID_KEY_MODE=decoy \
MODEL_WORKER_PROBE_ID=manual-$(date +%s) \
mise exec -- pnpm --filter @hv-pony-solver/model-worker check:deployment
```

检查器对 `https://hentaiverse.org`、`https://alt.hentaiverse.org` 分别发送无 Authorization 的模型 OPTIONS/HEAD，并对 WASM 发 HEAD；只检查响应头，不读取正文。意外正文及超时后迟到的正文均尽力取消，不等待清理，也不让清理失败替代契约错误。HEAD 请求 identity 编码，避免边缘压缩移除原始长度。每个请求默认 10 秒超时，共最多 5 轮，失败间隔 7.5 秒（总等待间隔 30 秒，请求本身耗时另计）。

URL、Origin 配置和网络异常只输出固定类别及请求上下文，不回显输入、底层错误或 cause。响应头不匹配仅报告字段与预期值，不回显服务端返回的原始值，包括 CORS、Vary、Content-Length 和 Content-Type。配置渲染中的本地 `main` 路径按字面保留，`$&` 等字符不作替换表达式展开。

| 探测             | 检查内容                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 模型 OPTIONS     | 204；精确回显 Origin；方法 `GET, HEAD, OPTIONS`，请求头 `Authorization`；预检上限 86400 秒；`no-store`、`Vary: Origin` |
| 无 Key 模型 HEAD | decoy 为 200，error 为 403；精确 Origin、`no-store`、`Vary: Origin`                                                    |
| WASM HEAD        | 200、公开 `*`、`application/wasm`、`nosniff`、一年 immutable、精确长度及 ETag                                          |

decoy HEAD 200 只证明诱饵路径，不能证明真实授权或 ORT 内容；WASM 探测检查路由、对象和长度，也不重新哈希正文。完整响应头由 [HTTP 契约](reference/model-worker-http.md)维护。

### 3. 客户端 Key、额度与下载验收

在用户脚本菜单或远程扩展设置页验证已知 Key、保存并查询额度，再下载模型。Key 仅留在本地受保护存储，不放进聊天、URL、CLI 参数、日志、fixture 或记录；浏览器保持标准 fetch、Bearer 和完整性校验，不用 GM 特权请求绕过 CORS。

客户端 Key 验证与额度查询均使用不计次的认证 `GET /quota`；模型 GET 预留，完整读取/校验且 IndexedDB 提交后 POST 确认。Key 验证不依赖模型 HEAD 长度，也不证明 R2 模型可用；额度依赖失败会阻止验证保存。缓存命中不下载；429 表示已确认 5 次，待确认槽位占满的 503 只表示暂时无法预留。失败、幂等和关闭额度的完整验收范围见[缓存策略](model-cache-strategy.md#变更前验证)。

扩展仅额度查询会在瞬时 Port 断开后重连一次；下载和 Key 操作不会自动重放。“连接已断开”属于内部传输证据，不能据此判断 KV、R2 或 DO 已失败。

### 4. 次级故障分流

| 首次失败证据                            | 优先核对                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| OPTIONS 405、旧 Allow/CORS/cache header | 部署 ref、Cloudflare route、传播；此时不应先改 Key                           |
| OPTIONS 正确但模型 403                  | 已部署 `INVALID_KEY_MODE`、KV 绑定和授权标记，禁止输出键值                   |
| 通用 500                                | R2 对象存在性、精确长度、已有 SHA-256 元数据及配置/KV 故障；查看脱敏分类日志 |
| 200 后长度或 SHA-256 错误               | real/decoy 选择、canonical 字节身份，不关闭校验                              |
| 429                                     | 已确认次数、UTC 月边界、Retry-After 和 DO 绑定                               |
| 503                                     | 区分依赖不可用与 pending 占满，按 Retry-After 等待                           |
| Failed to fetch                         | 脱敏后的 CORS、DNS、TLS、状态和 CF-Ray                                       |
| 校验通过但缓存失败                      | IndexedDB 事务，不能确认未提交的缓存                                         |
| 扩展 Port 错误                          | 后台重启、Port 错误内容、控制台；额度查询重连一次后的原始错误                |

## 发布后失败与回滚

公开检查失败不撤销已执行的部署，工作流也不自动回滚或二次部署。保存部署证据和脱敏的 method/Origin/status/header 差异，先区分传播、探测契约、route 和 Worker 故障。

需要回滚时部署保留 `ModelDownloadQuota` 类、`MODEL_DOWNLOAD_QUOTAS` 绑定及 SQLite 迁移的前向修复版本，再做公开探测。代码回滚不恢复 KV、R2、DO 状态或用户脚本产物；已正确的 CORS 不应因真实 Key 故障被回退。把 error 改回 decoy 也属于一次需明确授权的新部署。

## 待办运维项

以下只记录未实施的缩小探测面方案，不代表线上状态：

- 生成并上传与真实模型等长的诱饵，降低 HEAD 长度差异。
- 把历史大小写 KV Key 迁为 canonical 小写，完成前保留兼容查询。
- 评估 decoy GET 等价 DO 往返的计时收益与未授权请求成本。

## Cloudflare rate limit 建议

按 IP 的 Dashboard 限速可作为额外防护，覆盖 ONNX/ORT 两条模型路径；先观察再阻断。关注 Worker 调用、R2 读取/带宽、403 和诱饵比例。它不能替代 DO 的每 Key 事务额度；error 模式提高正常用户失败率时，应复核 Key 分发并在授权后调整策略。
