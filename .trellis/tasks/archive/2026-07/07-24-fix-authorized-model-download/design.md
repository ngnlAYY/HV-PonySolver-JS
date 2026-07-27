# 修复授权模型下载失败：技术设计

## 1. 问题与根因

当前 Userscript 使用标准跨域 `fetch`，并通过 `Authorization: Bearer <key>` 请求模型。自定义 `Authorization` header 会触发浏览器 CORS preflight。

2026-07-24 的无 Key、无 body 公开探测确认线上 `models.ngnl.host` 仍是旧契约：

- `OPTIONS` 返回 `405 Method Not Allowed`；
- `Allow` 只有 `GET, HEAD`；
- 缺少 `Access-Control-Allow-Headers: Authorization`；
- `HEAD` 仍使用旧的 `Cache-Control: public, max-age=86400`。

当前仓库源码已经实现 `OPTIONS 204`、Bearer、`no-store` 和允许的 Hentaiverse Origin。最近一次 GitHub workflow 仅完成 dry-run，实际 `Deploy Worker` 步骤被跳过。因此直接根因是部署漂移，不是 Key 内容、客户端保存顺序或完整性校验。

## 2. 设计目标

1. 尽快把线上 Worker 恢复到当前仓库契约。
2. 部署完成后自动验证公开 HTTP/CORS 契约，避免仅凭绿色 workflow 误判发布成功。
3. 验证过程不使用、打印或传输真实 Key，也不下载模型响应体。
4. 保留标准 `fetch`、Bearer、KV/R2、decoy/error 和完整性校验边界。
5. 对 Cloudflare 部署传播提供有限重试，并在最终失败时输出可定位的状态/header 差异。

## 3. 边界与职责

### 3.1 Userscript

不修改当前下载机制：

- Key 仍存储于 GM storage；
- 验证时通过 `accessKeyOverride` 使用候选 Key；
- 请求仍使用标准 `fetch` 与 Bearer header；
- 仍执行 byteLength 与 SHA-256 校验。

不改用 `GM_xmlhttpRequest` 或 query string。绕过 CORS 会掩盖服务端契约漂移，并扩大网络权限边界。

#### CodeQL Worker runtime URL hardening

GitHub code-scanning alert #1 指出 `importScripts(message.ortScriptUrl)` 把 Worker 消息字段直接用作客户端 URL sink。即使当前 `OnnxWorkerClient` 只发送内置配置，该消息边界也不应表达“调用者可选择 runtime URL”。修复契约：

- 从 `WorkerInitRequest` 与 worker 内部 `InitMessage` 删除 `ortScriptUrl`；
- `OnnxWorkerClient` 初始化消息只携带 `wasmPath` 与 `modelBuffer`；
- 非 bundled 模式由 `onnx-worker-entry.ts` 直接读取 `onnxRuntimeConfig.ortScriptUrl`（其唯一来源仍是 `ONNX_RUNTIME_ASSETS.cdn.scriptUrl`），再调用 `importScripts`；
- bundled 模式仍优先加载内置 runtime，不执行远程 `importScripts`；
- 不接受调用者提供的任意 HTTPS URL，也不通过 dismiss alert 代替修复；
- 更新消息契约、worker/client 测试和构建 smoke，默认分支 CodeQL 复扫用于最终关闭告警。

该改动不改变模型下载 URL、Bearer、CORS、KV/R2 或完整性校验，只收紧 ONNX Runtime JS 的加载来源。

### 3.2 Model Worker 运行时代码

当前运行时代码已满足目标契约，不计划修改：

- 模型路径 `OPTIONS` → `204`；
- `GET`/`HEAD` 使用 Bearer + KV 决策；
- 允许 `https://hentaiverse.org` 与 `https://alt.hentaiverse.org`；
- 模型和文本响应使用 `Cache-Control: no-store`。

本任务首先部署现有代码。只有部署后公开契约仍与源码不一致时，才回到代码/config 诊断。

### 3.3 部署后契约检查器

在 `apps/model-worker/scripts/` 新增独立、可测试的 Node.js ESM 脚本，建议命名为：

```text
check-deployment-contract.mjs
check-deployment-contract.test.mjs
```

核心 API 采用依赖注入：

```text
checkDeploymentContract({
  modelUrl,
  invalidKeyMode,
  origins,
  probeId,
  fetchImpl,
  attempts,
  retryDelayMs,
  requestTimeoutMs,
  sleep,
})
```

CLI 从环境变量读取非秘密配置：

- `MODEL_WORKER_URL`
- `MODEL_WORKER_INVALID_KEY_MODE`
- `MODEL_WORKER_PROBE_ID`

可选的 `MODEL_WORKER_CHECK_ATTEMPTS`、`MODEL_WORKER_CHECK_RETRY_DELAY_MS` 和 `MODEL_WORKER_CHECK_REQUEST_TIMEOUT_MS` 只控制有限重试、间隔与单请求超时；都必须是受校验的整数。

允许的 Origin 固定为当前服务契约中的两个 Hentaiverse Origin，或由受控的函数参数注入测试；不从不可信 workflow 输入扩展任意 Origin。

### 3.4 探测请求

对两个允许的 Origin 分别执行：

1. `OPTIONS`：
   - `Origin: <origin>`
   - `Access-Control-Request-Method: GET`
   - `Access-Control-Request-Headers: Authorization`
2. `HEAD`：
   - `Origin: <origin>`
   - 不发送 Key，不读取 body。

URL 添加非秘密的唯一 `deployment_check=<probeId>` query 参数，避免旧的 `public, max-age=86400` 缓存污染版本指纹；query 参数不得包含 Key、credential 或用户数据。

### 3.5 OPTIONS 契约

每个 Origin 必须满足：

- status 为 `204`；
- `Access-Control-Allow-Origin` 精确等于请求 Origin；
- `Access-Control-Allow-Methods` 包含且不遗漏 `GET`、`HEAD`、`OPTIONS`；
- `Access-Control-Allow-Headers` 包含 `Authorization`，比较时忽略大小写和列表空白；
- `Cache-Control` 为 `no-store`；
- `Vary` token 列表包含 `Origin`。

错误信息包含 method、Origin、实际 status/header 和期望值，但不输出 response body 或任何授权信息。

### 3.6 HEAD 契约

无 Key 的预期 status 由部署输入决定：

- `INVALID_KEY_MODE=decoy` → `200`；
- `INVALID_KEY_MODE=error` → `403`。

两种模式都必须满足：

- `Access-Control-Allow-Origin` 精确等于请求 Origin；
- `Cache-Control: no-store`；
- `Vary` 包含 `Origin`。

不把 `200` 当作真实模型证据；decoy 模式的无 Key `HEAD` 本来就是 `200`。真实/decoy 选择仍需用户用已知 Key及 R2 metadata 在受控环境验证。

### 3.7 重试与失败语义

Cloudflare deployment 可能存在短暂传播延迟，因此：

- 每轮执行完整 OPTIONS/HEAD 契约；
- 每个请求使用有限超时并在超时时主动 abort，防止单个未响应 edge 永久阻塞重试；
- 失败后等待固定短间隔并重试；
- 默认使用 13 次尝试与 5 秒间隔，为实测超过 20 秒的 Cloudflare 边缘传播提供 60 秒重试窗口，不无限轮询；
- 测试注入 `sleep`，不真实等待；
- 最终失败使 CLI 退出码为 1，并保留最后一次错误及总尝试次数；
- 成功输出简短确认，不输出完整 response headers。

不自动回滚。发布后检查失败说明“部署已发生但验收失败”，需要人工根据 Cloudflare deployment history 决定回滚，避免脚本在不完整上下文中自动执行第二次生产变更。

## 4. Workflow 集成

在 `.github/workflows/deploy-cloudflare-model-worker.yml` 的 `Deploy Worker` 之后增加 `Verify deployed Worker contract` 步骤。

运行条件与部署步骤一致：

```text
inputs.publish_model_worker && cloudflare secrets ready
```

传入：

- canonical model URL；
- `${{ inputs.invalid_key_mode }}`；
- `${{ github.run_id }}-${{ github.run_attempt }}` 作为非秘密 probe ID。

调用 model-worker package script，例如：

```text
pnpm --filter @hv-pony-solver/model-worker check:deployment
```

当 `publish_model_worker=false` 时，deploy 与 post-deploy check 都明确跳过。dry-run 仍保留，但不视为线上验收。

## 5. Package 与测试集成

`apps/model-worker/package.json`：

- 新增 `check:deployment` CLI script；
- 把 `check-deployment-contract.test.mjs` 纳入现有 `test` 命令，使根 `pnpm test`/`pnpm check` 自动覆盖。

测试至少覆盖：

1. `decoy` 模式的双 Origin 成功路径；
2. `error` 模式下 HEAD `403` 成功路径；
3. 线上当前旧行为 `OPTIONS 405` 与 `Allow: GET, HEAD` 被拒绝；
4. 缺少 `Access-Control-Allow-Headers: Authorization`；
5. 错误 allow-origin、allow-methods、cache-control、vary；
6. fetch 网络异常；
7. 前几轮失败、后续成功的传播重试；
8. 重试耗尽，CLI/核心函数返回可定位错误；
9. 请求只使用 OPTIONS/HEAD，且不设置 Authorization header；
10. probe ID 正确编码，不覆盖原 URL 的其他 query 参数。

测试使用注入的 `fetchImpl`/`sleep`，不访问公网。

## 6. 文档

更新：

- `README.md`：增加部署后 contract check 步骤/命令，并说明绿色 dry-run 不等于实际部署；
- `docs/model-worker-ops.md`：记录发布、公开 OPTIONS/HEAD 验收、用户本地 Key 验证及回滚顺序。

若 README 变更触发 docs drift guard，必须同步保持其由源码读取的 HTTP 事实一致，不放宽现有检查。

## 7. 恢复与验证流程

### 7.1 立即恢复

当前 `origin/main` 已包含正确 Worker 运行时代码；当前开发分支相对它仅有测试/guardrail 差异，不影响服务端运行时。因此无需等待本任务代码合并即可恢复：

1. 在实际操作前再次取得用户的生产部署确认；
2. 从 GitHub Actions 的 `main` 触发 `Deploy Cloudflare Model Worker`；
3. 显式设置 `publish_model_worker=true`；
4. 默认保持 `invalid_key_mode=decoy`；
5. 检查 `Deploy Worker` step 本身为 `success`；
6. 运行无 Key OPTIONS/HEAD 探测确认新契约；
7. 由用户在本地菜单重新验证 Key，Key 不发送给 AI。

### 7.2 次级故障分流

若 preflight 修复后仍失败：

- `HTTP 403`：核对 invalid mode、KV namespace 与 entry；
- HTTP 200 后大小/SHA 错误：核对 real/decoy 选择、R2 object 与 shared manifest；
- 仍为 `Failed to fetch`：核对 DNS/TLS、浏览器扩展拦截和 Network 面板；
- 缓存写入错误：单独检查 IndexedDB，不改变已下载模型授权链路。

## 8. 安全与兼容性

- 任何自动化检查都不需要真实 Key。
- Key 不进入 URL、CLI 参数、GitHub log、测试 fixture、task artifact 或错误消息。
- 同时支持 `decoy` 与 `error` 两种部署模式。
- 同时验证主世界和 alt Hentaiverse Origin。
- 保持 Node.js 22、ESM 和现有标准库优先风格，不引入依赖。

## 9. 回滚

### 生产运行时

- 从 Cloudflare deployment history 回滚到已知 deployment，或重新部署已知 git commit；
- KV/R2 不随 Worker code rollback 自动改变；
- 回滚后重新执行公开 OPTIONS/HEAD 检查。

### Guardrail 代码

- post-deploy checker 只影响 workflow 验收，不改变 Worker runtime；
- 若 checker 误报，可回滚 workflow step/package script，但不得通过回滚到旧 Worker 或关闭 CORS/完整性校验规避问题。
