# Research: Model Worker 服务端授权与部署链路

- **Query**: 排查 `request-router`、`model-access`、`env`、`model-response`、Wrangler 模板/渲染、GitHub 部署 workflow、shared model manifest 与测试，识别线上版本、KV binding、R2 object/manifest 漂移的最可能根因及安全验证步骤
- **Scope**: internal + public endpoint metadata + GitHub Actions metadata
- **Date**: 2026-07-24
- **Safety boundary**: 未使用或猜测任何真实 Key；未发起模型 `GET`；线上只做无授权、无响应体的 `OPTIONS`/`HEAD`；未读取或修改 Cloudflare KV/R2；未修改产品代码

## 结论摘要

**最可能且已有直接证据的根因是：`models.ngnl.host` 仍运行 Bearer/OPTIONS 改造前的旧 Worker；当前 Userscript 的跨域 `Authorization: Bearer` 请求会在浏览器 preflight 阶段被旧 Worker 的 `405` 拦住，实际授权 `GET` 因而不会到达 KV。**

证据链完整且彼此独立：

1. 当前源码对模型路径的 `OPTIONS` 返回 `204`，允许 `Authorization`，并把 `OPTIONS` 纳入 `Allow`（`apps/model-worker/src/request-router.ts:18-23`、`apps/model-worker/src/model-response.ts:8-9,57-68`）。
2. 2026-07-24 对线上唯一查询参数的无 body 探测仍返回：
   - `OPTIONS` → `405 Method Not Allowed`
   - `Allow: GET, HEAD`
   - 没有 `Access-Control-Allow-Headers: Authorization`
   - `HEAD` → `Cache-Control: public, max-age=86400`
3. 当前源码的模型响应必须是 `Cache-Control: no-store`（`apps/model-worker/src/model-response.ts:4,45-49,70-75`）。
4. Git 历史中 `Authorization: Bearer`、`OPTIONS` 和 `no-store` 契约由同一提交 `1db43f0`（2026-06-22）引入；线上行为位于该契约之前。公开响应没有部署 ID，因此不能仅凭 headers 指定唯一旧 SHA，但可以高置信度判定为 **pre-`1db43f0` 语义**。
5. GitHub 目前可见的 Model Worker workflow 只有一次：run `28636662257`，head `f0ea6f8`，2026-07-03。该 run 的 `Render Wrangler config`、测试和 `Wrangler dry-run` 成功，但 `Deploy Worker` 明确为 `skipped`。所以 workflow 总体 `success` 不代表发布成功。

这已经足以解释“确认正确的 Key 仍无法下载”：浏览器为跨域 `Authorization` 先发送 `OPTIONS`；线上 `405` 使浏览器阻止后续 `GET`，Key 是否存在于 KV 尚未参与这次失败。

KV namespace 内容和真实 R2 object 是否与 manifest 对齐仍需控制面权限验证；它们是部署旧版本修复后的次级检查项，而不是解释当前 preflight 失败所必需的假设。

## 当前服务端授权链路

### 请求路由

- Worker 入口先执行 `normalizeEnv(env)`，任何异常统一转成带 CORS 的 `500 Internal Server Error`（`apps/model-worker/src/index.ts:8-16`）。
- 路径必须精确等于 `env.publicModelPath`，否则 `404`（`apps/model-worker/src/request-router.ts:11-16`）。
- 模型路径上的 `OPTIONS` 在访问 KV/R2 之前直接返回 preflight（`apps/model-worker/src/request-router.ts:18-20`）。
- 只有 `GET`/`HEAD` 进入授权选择；其他方法返回 `405` 与 `Allow: GET, HEAD, OPTIONS`（`apps/model-worker/src/request-router.ts:5-9,22-27`）。

### Bearer 解析与 KV 查找

- 只读取 `Authorization` header，匹配 `/^Bearer\s+([^\s]+)$/i`；query string 不参与授权（`apps/model-worker/src/model-access.ts:4,10-21`）。
- token 必须是 64 位十六进制；shared 层先尝试 canonical lowercase，再兼容原始 mixed-case 与 uppercase 历史 KV key（`packages/shared/src/token.ts:1-32`）。
- 任一 `MODEL_KEYS.get(lookupKey)` 返回非 `null` 即选择 `real`（`apps/model-worker/src/model-access.ts:27-31`）。
- 无 token、格式错误或 KV miss 时，`INVALID_KEY_MODE=decoy` 选择 decoy，`error` 则选择 `forbidden`（`apps/model-worker/src/model-access.ts:6-8,23-34`）。

### Env 与 R2 选择

- 运行时要求 `MODEL_KEYS` 和 `MODEL_BUCKET` 都存在且带 `.get()`；真实/decoy object key 必须为非空文本（`apps/model-worker/src/env.ts:15-37`）。
- Env 接口明确绑定名及变量（`apps/model-worker/src/worker-types.ts:11-27`）。
- `real` 选择 `env.realModelObjectKey`，否则选择 `env.decoyModelObjectKey`；选中的 object 缺失返回 `500`，不会静默回退（`apps/model-worker/src/model-response.ts:84-102`）。
- `HEAD` 仍访问选中的 R2 object 并返回其 headers，但响应体为 `null`（`apps/model-worker/src/model-response.ts:93-102`）。
- 响应不暴露授权判定 header；测试也明确断言 `x-hv-model-access` 不存在（`apps/model-worker/test/index.test.ts:99-118` 等）。因此只看 HTTP 200 无法区分 real/decoy，必须与 R2 object metadata 的 ETag 对照。

## 逐项发现、置信度与验证建议

| #   | 发现                                                                                                    | 证据（file:line / 外部证据）                                                                                                                                                                                                                                   | 置信度                                               | 安全验证建议                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 线上 Worker 不支持当前 `Authorization` preflight，足以直接导致浏览器下载失败                            | 当前应为 `OPTIONS 204`：`apps/model-worker/src/request-router.ts:18-20`、`apps/model-worker/src/model-response.ts:57-68`；线上 2026-07-24 唯一 query 探测为 `405`、`Allow: GET, HEAD`、无 ACAH                                                                 | **极高**                                             | 部署后先做无 Key、无 body 的 `OPTIONS`；必须变为 `204` 且出现 `Access-Control-Allow-Headers: Authorization`，再进行任何真实 Key 验证   |
| 2   | 线上是 pre-`1db43f0` 的 HTTP/授权契约，而非当前源码                                                     | 当前 `ALLOWED_METHODS` 与 CORS 常量：`apps/model-worker/src/request-router.ts:5`、`apps/model-worker/src/model-response.ts:4,8-9`；Git `-S` 历史显示 Bearer/OPTIONS/no-store 在 `1db43f0` 引入；线上仍为 `GET, HEAD` 与 `public, max-age=86400`                | **极高（语义边界）**；**中等（精确 SHA）**           | 用 Cloudflare deployment history 确认实际 deployment ID、时间和 source/version；公开 headers 只能做契约指纹，不能证明唯一 SHA          |
| 3   | 最近 GitHub workflow 没有实际部署                                                                       | workflow 输入默认 `publish_model_worker=false`：`.github/workflows/deploy-cloudflare-model-worker.yml:4-18`；部署步骤条件：`:99-107`；run `28636662257` 的 `Deploy Worker` 为 `skipped`                                                                        | **极高**                                             | 触发 workflow 时显式选择 `publish_model_worker=true`；验收必须检查 `Deploy Worker` step 为 `success`，不能只看整个 workflow 的绿色状态 |
| 4   | 该 dry-run 使用了完整 Cloudflare secrets，并渲染了正确的 binding 名，但这不代表线上已绑定这些资源       | secret gate 与渲染：`.github/workflows/deploy-cloudflare-model-worker.yml:51-79`；run log 显示 `env.MODEL_KEYS`/`env.MODEL_BUCKET` 且 resource 值被 `***` mask，随后 `--dry-run: exiting now`                                                                  | **高**                                               | 在新 deployment 的控制面详情中核对 binding target，而不是复用 dry-run 日志作为部署证据                                                 |
| 5   | 当前 Wrangler 模板会把 secrets 渲染到正确绑定名；guard 只验证格式与 TOML 结构，不验证 KV 内容/R2 object | `apps/model-worker/wrangler.template.toml:9-21`；`apps/model-worker/scripts/wrangler-config-guard.mjs:1-26,153-161`；renderer：`apps/model-worker/scripts/wrangler-config-renderer.mjs:42-65`                                                                  | **高**                                               | 控制面核对 namespace ID、bucket 名、运行时 vars；随后单独验证已知 token 的 KV entry 和两个 R2 object metadata                          |
| 6   | 线上至少存在可用的 Worker 配置与 decoy 读取路径，但不能据此确认 KV namespace 身份或真实 object          | 线上无 Key `HEAD` 为 `200` 且 ETag 为 `"6222fbc21b970bfb0e6da24be1b54683"`；按 `normalizeEnv` 与 `createModelResponse`，缺 binding/变量或 decoy object 缺失应为 `500`（`apps/model-worker/src/env.ts:22-37`、`apps/model-worker/src/model-response.ts:93-97`） | **中高**（假设线上仍沿用同一 Env 结构）              | 在控制面核对实际 deployed bindings；不要把公共 decoy `200` 误作 KV 命中证据                                                            |
| 7   | 真实 R2 object 与 shared manifest 可能漂移，服务端不会自行发现                                          | manifest 固定为 version `yolo26n-640-2026-05-14`、9809075 bytes、SHA-256 `318e…f070`（`packages/shared/src/model.ts:3-7`）；Worker 只导入 `MODEL_FILENAME` 并直接流式返回 R2 body（`apps/model-worker/src/model-response.ts:1,93-102`）                        | **高（缺少服务端校验）**；**未知（线上是否已漂移）** | 私有控制面先核对 real object key/size/ETag，再在受控环境对 real object 做完整 SHA-256 校验；ETag 不能替代 manifest SHA-256             |
| 8   | deployment workflow 不上传或校验真实模型 artifact，也不检查 KV entry                                    | workflow 只有依赖安装、audit、render、typecheck、test、dry-run、deploy（`.github/workflows/deploy-cloudflare-model-worker.yml:31-107`）；发布说明仅指导人工预校验/上传（`scripts/model-release-notes.mjs:9-23`）                                               | **极高**                                             | 把“Worker 发布成功”和“KV/R2 数据正确”视为两个独立验收项；两者都通过后才做端到端 Key 验证                                               |
| 9   | 单元测试充分覆盖当前逻辑，但全部使用测试配置和内存 fixture，不能证明生产环境                            | Vitest 渲染 `test-kv`/`test-bucket`（`apps/model-worker/vitest.config.ts:5-17`）；fixture 使用 `MockKvNamespace`/`MockR2Bucket`（`apps/model-worker/test/helpers/model-worker-fixture.ts:30-59,146-165`）                                                      | **极高**                                             | 保留单元测试作为逻辑证据，同时增加/执行单独的部署后 metadata smoke test；不要把 fixture 通过当成生产 binding 证据                      |
| 10  | `INVALID_KEY_MODE=decoy` 会让 KV miss 也返回 `200`，仅凭 status 无法判断 Key 是否有效                   | `apps/model-worker/src/model-access.ts:6-8,23-34`；real/decoy 都由同一路径返回 200（`apps/model-worker/src/model-response.ts:93-102`）                                                                                                                         | **极高**                                             | 用已知 real/decoy R2 ETag 对照授权与无授权 `HEAD`；不要发送猜测 token，也不要依靠 status 枚举 Key                                      |

## 线上只读探测结果

### 1. 无授权 `HEAD`（无 body）

2026-07-24 08:25:53 UTC，带唯一的非授权 query `diagnostic=20260724-0821` 和允许的 Origin，以排除复用普通 URL 缓存的疑问：

```text
HTTP/1.1 200 OK
Access-Control-Allow-Origin: *
Cache-Control: public, max-age=86400
Content-Type: application/octet-stream
Content-Disposition: inline; filename="yolo26n-640.onnx"
ETag: "6222fbc21b970bfb0e6da24be1b54683"
X-Content-Type-Options: nosniff
```

与当前源码冲突：当前必须 `Cache-Control: no-store`，允许的 Hentaiverse Origin 应被回显，并带 `Vary: Origin`（`apps/model-worker/src/model-response.ts:4,17-30,33-43,70-81`）。

### 2. Authorization preflight `OPTIONS`（无 body、无 Key）

2026-07-24 08:25:55 UTC，Origin 为 `https://alt.hentaiverse.org`，请求方法 `GET`，请求 header `Authorization`：

```text
HTTP/1.1 405 Method Not Allowed
Access-Control-Allow-Origin: *
Allow: GET, HEAD
```

缺少当前契约要求的：

```text
HTTP 204
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
Access-Control-Allow-Headers: Authorization
Cache-Control: no-store
Vary: Origin
```

第一次并行 `OPTIONS` 请求曾遇到一次 TLS `unexpected eof`；随后普通重试和唯一 query 复核均稳定得到相同 `405` 语义，因此 TLS 瞬态不是结论依据。

### 3. 非模型路径 `HEAD`（无 body）

线上返回 `404`。这确认 custom domain 正在响应 Worker 路由，但不提供精确 deployment version。

## GitHub Actions 部署事实

### Workflow 逻辑

- 仅支持手动 `workflow_dispatch`（`.github/workflows/deploy-cloudflare-model-worker.yml:3-18`）。
- `publish_model_worker` 默认是 `false`（`:4-10`）。
- secrets 完整时，无论是否发布都会 render 与 dry-run（`:51-64,72-79,87-97`）。
- 只有 `publish_model_worker=true` 且 secrets 完整才执行 deploy（`:99-107`）。

因此“render + test + dry-run 全绿、workflow conclusion=success”完全可能没有部署，这正是现有唯一 run 的状态。

### 最近且唯一可见 run

- URL: https://github.com/ngnlAYY/HV-PonySolver-JS/actions/runs/28636662257
- Created: `2026-07-03T03:35:18Z`
- Head: `f0ea6f8a0f422b013177133c6605f78692a1ec23`
- Conclusion: `success`
- `Render Wrangler config`: `success`
- `Typecheck`: `success`
- `Test`: `success`
- `Wrangler dry-run`: `success`
- `Deploy Worker`: **`skipped`**

GitHub run log进一步显示 secrets gate 通过、dry-run 列出 `env.MODEL_KEYS` 与 `env.MODEL_BUCKET`，但最后是 `--dry-run: exiting now.`。资源值均被 GitHub 正确 mask。

`f0ea6f8` 到当前工作树的服务端源码、Wrangler 模板和 deploy workflow 没有差异；只有 `apps/model-worker/test/index.test.ts` 多两行断言。因此该 dry-run 对当前核心服务端逻辑仍有参考价值，但没有任何发布价值。

## Wrangler / binding / object 关系

### 模板映射

`apps/model-worker/wrangler.template.toml:9-21` 固定：

| Runtime name             | Source                          |
| ------------------------ | ------------------------------- |
| `PUBLIC_MODEL_PATH`      | `/yolo26n-640.onnx`             |
| `REAL_MODEL_OBJECT_KEY`  | `real/yolo26n-640.onnx`         |
| `DECOY_MODEL_OBJECT_KEY` | `decoy/yolo26n-640.onnx`        |
| `INVALID_KEY_MODE`       | workflow/render input           |
| `MODEL_KEYS`             | `${MODEL_KEYS_KV_NAMESPACE_ID}` |
| `MODEL_BUCKET`           | `${MODEL_BUCKET_NAME}`          |

renderer 要求两个资源变量存在，并在 deploy 模式拒绝 test placeholder（`apps/model-worker/scripts/wrangler-config-renderer.mjs:10-29,42-65`）。guard 校验 32 位 lowercase hex namespace ID、bucket 名格式及绑定名/section（`apps/model-worker/scripts/wrangler-config-guard.mjs:1-26,49-67,129-161`）。

这些检查不能回答：

- secret 指向的 namespace 是否是期望的生产 namespace；
- 用户持有的已知 token 是否存在于该 namespace；
- bucket 内 real/decoy key 是否都存在；
- real object 是否是 shared manifest 对应的 9809075-byte artifact；
- 线上旧 deployment 是否使用了本次 dry-run 的任何配置。

## Shared model manifest 与 R2 漂移

Canonical manifest 位于 `packages/shared/src/model.ts:1-7`：

```text
filename  = yolo26n-640.onnx
version   = yolo26n-640-2026-05-14
byteLength = 9809075
sha256    = 318e96a0c32202fea2f4c0aed6010f5ba4a13952f5206a9b1cddc9a4fcf1f070
```

shared 测试把上述值固定下来（`packages/shared/test/model.test.ts:5-15`）。Userscript 会按该 manifest 做下载完整性校验；Worker 则不读 `MODEL_VERSION`/`MODEL_INTEGRITY`，只返回固定 R2 key 的当前内容。因此同名 real object 被覆盖、错桶绑定或上传旧模型都会产生 HTTP 200 后的完整性失败。

当前无授权 `HEAD` 只能观察 decoy 路径的 ETag；没有真实 Key、Cloudflare 控制面 metadata 或 real object body，无法判断真实 object 的 size/hash。仓库中也没有记录线上 ETag `6222fbc21b970bfb0e6da24be1b54683`。

## 测试覆盖现状

### 已覆盖

- query-only key 不授权 real：`apps/model-worker/test/index.test.ts:45-61`
- lowercase/uppercase/mixed-case KV lookup：`:63-97,120-148`
- 有效 Bearer → real：`:99-118`
- invalid Bearer / KV miss → decoy 或 403：`:165-215,445-575`
- authorized `HEAD`：`:217-229`
- Hentaiverse/alt Origin GET：`:244-272`
- Authorization preflight：`:312-348`
- default public model path：`:386-402`
- R2 `httpEtag` 与 HEAD/GET：`:404-443`
- selected R2 object missing → 500：`:599-615`
- required Env config missing → 500：`:629-641`
- binding/variable normalization：`apps/model-worker/test/env.test.ts:11-46`
- deploy config placeholder、format、binding section guards：`apps/model-worker/scripts/render-wrangler-config.test.mjs:173-333`
- token normalization/lookup keys：`packages/shared/test/token.test.ts:9-69`
- manifest constants：`packages/shared/test/model.test.ts:5-15`

### 测试不能证明的生产事实

- `apps/model-worker/vitest.config.ts:10-17` 明确使用 `test-kv`/`test-bucket`。
- `apps/model-worker/test/helpers/model-worker-fixture.ts:30-59,146-165` 使用内存 Map 和 mock R2。
- fixture 的 real/decoy body 是随机文本，不是 manifest artifact（`:129-150`）。
- workflow 没有部署后 public endpoint smoke test，也没有 Cloudflare KV/R2 内容检查（`.github/workflows/deploy-cloudflare-model-worker.yml:31-107`）。

本次研究未重新执行测试；以上为源码与现有测试静态核对。PRD 已记录本地质量检查通过，但那不改变生产证据缺口。

## 根因优先级

### P0 — 线上 Worker 未部署 Bearer/OPTIONS 版本

- **状态**：已证实，且单独足以解释浏览器失败。
- **机制**：Userscript 跨域发送 `Authorization` → 浏览器发送 preflight → 线上 `OPTIONS 405` → 浏览器不发送/不暴露后续 `GET`。
- **与 Key 正确性无关**：此阶段没有执行 `MODEL_KEYS.get()`。

### P1 — 新 deployment 的 KV target 或 entry 不一致

- **状态**：未验证。
- **已有弱反证**：dry-run secrets 完整、binding 名正确；线上 decoy `HEAD 200` 暗示旧 deployment 的基本 bindings/config 可用。
- **仍可能发生**：GitHub secret 指向另一 namespace，或已知 token 不在该 namespace；`decoy` 模式会把 KV miss 隐藏成 200 decoy。

### P1 — real R2 object 与 manifest 漂移

- **状态**：未验证。
- **为何必须检查**：Worker 不校验 real object，workflow 也不校验/上传 artifact；Userscript 会在 HTTP 200 后拒绝错误 size/hash。
- **当前不能从公网判定**：无授权 `HEAD` 只走 decoy，ETag 也不是 manifest SHA-256。

### P2 — binding/必填变量完全缺失，或 decoy object 缺失

- **状态**：对当前线上较不可能。
- **依据**：按当前/历史同族入口，缺 binding/变量或选中的 decoy object 缺失应为 500；实际无 Key `HEAD` 是 200。
- **限制**：仍需 deployment 控制面确认精确 target。

## 安全验证顺序

### A. 先验证公开版本指纹（零 Key、零 body）

部署前后均执行：

```bash
curl --silent --show-error --request OPTIONS --dump-header - --output /dev/null \
  --header 'Origin: https://hentaiverse.org' \
  --header 'Access-Control-Request-Method: GET' \
  --header 'Access-Control-Request-Headers: Authorization' \
  'https://models.ngnl.host/yolo26n-640.onnx?diagnostic=<unique-nonce>'

curl --silent --show-error --head \
  --header 'Origin: https://hentaiverse.org' \
  'https://models.ngnl.host/yolo26n-640.onnx?diagnostic=<unique-nonce>'
```

部署后的最低验收：

- `OPTIONS 204`
- `Access-Control-Allow-Origin: https://hentaiverse.org`
- `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`
- `Access-Control-Allow-Headers: Authorization`
- `Cache-Control: no-store`
- `Vary` 含 `Origin`
- `HEAD` 不返回 body，且不再出现 `Cache-Control: public, max-age=86400`

只要 `OPTIONS` 仍为 405，就停止 Key/R2 排查：线上代码版本尚未切换。

### B. 确认 workflow 真正发布

1. 手动触发 `Deploy Cloudflare Model Worker`。
2. 显式设置 `publish_model_worker=true`。
3. 按既有策略选择 `invalid_key_mode`；默认应保持 `decoy`。
4. 检查 **`Deploy Worker` step 本身** 为 `success`。
5. 从 Cloudflare deployment history 记录新 deployment ID、时间，并确认它晚于本次 workflow。
6. 再执行步骤 A；控制面记录与公开行为必须同时更新。

### C. 控制面核对 bindings 与 runtime vars

在不把 secrets 写入 issue、chat、workflow log 的前提下核对：

- deployed `env.MODEL_KEYS` 指向预期 namespace ID；
- deployed `env.MODEL_BUCKET` 指向预期 bucket；
- `PUBLIC_MODEL_PATH=/yolo26n-640.onnx`；
- `REAL_MODEL_OBJECT_KEY=real/yolo26n-640.onnx`；
- `DECOY_MODEL_OBJECT_KEY=decoy/yolo26n-640.onnx`；
- `INVALID_KEY_MODE` 与本次 deploy input 一致；
- 已知 token 以 64-hex key 存在于同一 namespace，值读取结果不是 `null`。

不要把 token 放进 URL query、命令输出或 CI log；当前授权契约只允许 Bearer header。

### D. 用已知 Key 做无 body 的 real/decoy 选择验证

先从 R2 控制面取得 real/decoy 两个 object 的 metadata ETag。随后：

- 无授权 `HEAD` 应匹配 decoy ETag（`INVALID_KEY_MODE=decoy`）；
- 已知授权 Key 的 `HEAD` 应匹配 real ETag；
- 两次都必须 `Cache-Control: no-store`；
- 不发送猜测 Key，不根据 status 扫描 Key 空间。

为了避免 Key 进入 shell history，可交互读入变量并通过 curl config stdin 发送；只打印响应 headers：

```bash
read -r -s MODEL_KEY
printf '\n'
printf 'header = "Authorization: Bearer %s"\n' "$MODEL_KEY" | \
  curl --silent --show-error --config - --head \
    --header 'Origin: https://hentaiverse.org' \
    'https://models.ngnl.host/yolo26n-640.onnx?diagnostic=<unique-nonce>'
unset MODEL_KEY
```

若无法从控制面取得 ETag，仅有 authorized `HEAD 200` 仍不能证明返回了 real，因为 decoy 模式同样返回 200。

### E. 验证 real object 与 manifest

1. 控制面确认 `real/yolo26n-640.onnx` 存在且 size 为 `9809075`。
2. 在受控私有环境把 real object 下载到临时文件；不要把内容、Key 或 credential 输出到日志。
3. 运行仓库既有校验：

```bash
MODEL_FILE=/private/tmp/yolo26n-640.onnx \
  corepack pnpm --filter @hv-pony-solver/userscript verify-model-integrity
```

4. 必须匹配：
   - byteLength `9809075`
   - SHA-256 `318e96a0c32202fea2f4c0aed6010f5ba4a13952f5206a9b1cddc9a4fcf1f070`
5. 校验后安全删除临时文件。

R2 ETag 只能用于确认 Worker 选中了哪个 object，不能替代 SHA-256 完整性验证。

### F. 回滚边界

- Worker 代码/config 回滚：从 Cloudflare deployment history 回滚到已知 deployment，或重新部署已知 git commit；KV/R2 不随 Wrangler deploy 自动变化。
- R2 artifact 回滚：只恢复事先保留、且已通过 canonical manifest 校验的 real object；不要通过关闭 Userscript 完整性校验或修改 manifest 去“接受”未知 object。
- 每次回滚后重新执行 A、D、E；公开 preflight、object 选择、完整性三个层次必须分别通过。

## Files Found

| File Path                                                   | Description                                       |
| ----------------------------------------------------------- | ------------------------------------------------- |
| `apps/model-worker/src/index.ts`                            | Worker 入口、Env normalization、统一 500          |
| `apps/model-worker/src/request-router.ts`                   | 路径、OPTIONS、方法路由                           |
| `apps/model-worker/src/model-access.ts`                     | Bearer 解析、KV lookup、real/decoy/forbidden 决策 |
| `apps/model-worker/src/env.ts`                              | binding/变量校验与 normalization                  |
| `apps/model-worker/src/model-response.ts`                   | R2 object 选择、HEAD/body、CORS/cache headers     |
| `apps/model-worker/src/worker-types.ts`                     | `MODEL_KEYS`、`MODEL_BUCKET` 与 runtime vars 类型 |
| `apps/model-worker/wrangler.template.toml`                  | custom domain、bindings、object keys 模板         |
| `apps/model-worker/scripts/wrangler-config-renderer.mjs`    | secrets → generated Wrangler config               |
| `apps/model-worker/scripts/wrangler-config-guard.mjs`       | deploy config 格式与 binding section guard        |
| `apps/model-worker/scripts/render-wrangler-config.test.mjs` | 渲染与 guard 测试                                 |
| `.github/workflows/deploy-cloudflare-model-worker.yml`      | 手动 dry-run/deploy workflow                      |
| `packages/shared/src/token.ts`                              | 64-hex token 与 historical-case lookup            |
| `packages/shared/src/model.ts`                              | canonical filename/version/byteLength/SHA-256     |
| `apps/model-worker/test/index.test.ts`                      | Worker HTTP/Bearer/CORS/R2 行为测试               |
| `apps/model-worker/test/env.test.ts`                        | binding/变量拒绝测试                              |
| `apps/model-worker/test/helpers/model-worker-fixture.ts`    | 内存 KV/R2 fixture                                |
| `packages/shared/test/token.test.ts`                        | token contract tests                              |
| `packages/shared/test/model.test.ts`                        | manifest constant tests                           |
| `scripts/model-release-notes.mjs`                           | 人工 artifact 预校验/上传说明生成器               |
| `docs/model-cache-strategy.md`                              | `no-store` 授权缓存决策                           |
| `docs/model-worker-ops.md`                                  | manual deploy input 与 invalid mode 运维流程      |

## Related Specs

- `.trellis/spec/model-worker/backend/index.md`
- `.trellis/spec/model-worker/backend/error-handling.md`
- `.trellis/spec/model-worker/backend/quality-guidelines.md`
- `.trellis/spec/model-worker/backend/database-guidelines.md`
- `.trellis/spec/model-worker/backend/directory-structure.md`
- `.trellis/spec/shared/backend/quality-guidelines.md`

上述 backend specs 当前均为未填写模板（例如 `.trellis/spec/model-worker/backend/index.md:15-21` 标注 `To fill`，其他文件主体为 `(To be filled by the team)`），没有额外的授权、KV、R2 或部署契约；本次事实来源以运行时代码、README/docs、tests、Git history、GitHub run metadata 和公开 endpoint headers 为准。

## Caveats / Not Found

- 公开 endpoint 没有 commit SHA/deployment ID header，故只能证明契约版本陈旧，不能仅凭 headers 指定唯一 deployed SHA。
- 未使用 Cloudflare account credential；没有直接读取 deployment detail、KV namespace、KV key 或 R2 metadata。
- 未发送真实 Key或猜测 Key；所以没有从公网验证 real object selection。
- 未下载任何线上模型 body；所以没有计算线上 real/decoy SHA-256。
- GitHub 当前可见 workflow history 只有 run `28636662257`；若曾有本地 `wrangler deploy` 或已删除的 Actions run，GitHub 列表无法证明或排除。

---

## 补充研究：`Failed to fetch`、双 Origin CORS、DNS 与 TLS（2026-07-24）

### 新线索的故障分层

用户设置 Key 时得到的是原生 `Failed to fetch`，没有 `HTTP <status>`、Content-Length、实际 byteLength 或 SHA-256 错误。该线索把失败点收窄到 `fetch()` 尚未取得可供 JavaScript 使用的 `Response`：

- 客户端只有在 `await fetch(...)` 成功返回后才检查 `response.ok` 并生成 `模型下载失败: HTTP <status>`（`apps/userscript/src/model/model-downloader.ts:166-170`）。
- byteLength 与 SHA-256 校验更晚发生（`apps/userscript/src/model/model-downloader.ts:171-179`）。
- 跨域标准 `fetch` 携带 `Authorization` 会先发 preflight；preflight 不满足 CORS 时，浏览器不会把服务端的 405 作为普通 `Response` 暴露给脚本，而是拒绝 fetch promise，常见文本正是 `TypeError: Failed to fetch`。

因此新线索与已观察到的线上 `OPTIONS 405` 完全吻合，并反向降低了 KV miss、403、real/decoy object 错配和完整性失败作为“当前第一失败点”的可能性。

### 两个允许 Origin 的公开 OPTIONS 复核

所有请求均：

- 不含任何 Key 或 Authorization value；
- 只声明 `Access-Control-Request-Headers: Authorization`；
- 使用唯一 `diagnostic` query 规避普通 URL 缓存复用；
- `--output /dev/null`，不读取响应体。

#### `Origin: https://hentaiverse.org`

2026-07-24 08:54:13 UTC，HTTP/1.1 串行重试后的稳定结果：

```text
HTTP/1.1 405 Method Not Allowed
Access-Control-Allow-Origin: *
Allow: GET, HEAD
Content-Type: text/plain;charset=UTF-8
```

2026-07-24 09:03:03 UTC 再以 HTTP/2 复核，结果仍为：

```text
HTTP/2 405
access-control-allow-origin: *
allow: GET, HEAD
```

#### `Origin: https://alt.hentaiverse.org`

2026-07-24 08:56:15 UTC：

```text
HTTP/1.1 405 Method Not Allowed
Access-Control-Allow-Origin: *
Allow: GET, HEAD
Content-Type: text/plain;charset=UTF-8
```

#### 共同缺失项

两个 Origin 均缺少：

```text
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
Access-Control-Allow-Headers: Authorization
Cache-Control: no-store
Vary: Origin
```

当前源码应在任何 KV/R2 访问之前对模型路径返回 `OPTIONS 204`（`apps/model-worker/src/request-router.ts:18-20`、`apps/model-worker/src/model-response.ts:57-68`）。所以双 Origin 的失败不是 `ALLOWED_ORIGINS` 中漏配某一个域名，而是线上 Worker 根本尚未部署 OPTIONS/Bearer 契约。

- **置信度**：极高。
- **验证建议**：部署后对两个 Origin 分别重跑同样的无 Key OPTIONS；两者必须都是 204，并分别回显请求 Origin。只要任一仍为 405，浏览器真实 Key 验证就没有继续执行的意义。

### 两个 Origin 的无授权 HEAD 复核

2026-07-24 08:51:53–08:51:54 UTC，两个 Origin 均返回相同旧指纹：

```text
HTTP/1.1 200 OK
Access-Control-Allow-Origin: *
Cache-Control: public, max-age=86400
Content-Type: application/octet-stream
Content-Disposition: inline; filename="yolo26n-640.onnx"
ETag: "6222fbc21b970bfb0e6da24be1b54683"
```

这说明：

1. HTTPS endpoint 与 Worker/decoy R2 路径在探测时可达；
2. 两个 Origin 没有出现不同的 route 或 object；
3. `public, max-age=86400` 再次证明线上不是当前 `no-store` 版本；
4. HEAD 可达不能挽救 Authorization fetch，因为浏览器真正阻断点是 OPTIONS。

- **置信度**：极高。
- **验证建议**：部署后两个 Origin 的 HEAD 都必须改为 `Cache-Control: no-store`、回显对应 Origin，并带 `Vary: Origin`。

### DNS 结果

2026-07-24 系统 resolver 返回：

```text
models.ngnl.host.  A  172.67.187.70
models.ngnl.host.  A  104.21.80.217
```

查询未返回 AAAA 或 CNAME answer。两个 A 地址均为 Cloudflare 边缘地址；endpoint 的 HTTP 响应也带 `Server: cloudflare`。

- **判断**：从本研究网络视角，域名能够稳定解析到 Cloudflare，未发现 NXDOMAIN、错误 CNAME 或仅有不可达 AAAA 的问题。
- **置信度**：高（只代表本次 resolver/时间点；用户本地 DNS、污染或扩展拦截仍需浏览器现场证据）。
- **验证建议**：用户环境若仍失败，在同一浏览器/主机记录 `models.ngnl.host` 的 DNS 解析与 Network 面板错误；不要仅用另一台机器的解析替代现场证据。

### TLS 结果

直接连接两个 DNS A 地址、使用 SNI 与 hostname verification `models.ngnl.host`，结果均为：

```text
Protocol version: TLSv1.3
Ciphersuite: TLS_AES_256_GCM_SHA384
Verification: OK
Verified peername: models.ngnl.host
Peer certificate: CN=ngnl.host
```

证书元数据：

```text
subject=CN=ngnl.host
issuer=C=US, O=Google Trust Services, CN=WE1
notBefore=Jul 16 03:28:25 2026 GMT
notAfter=Oct 14 04:28:16 2026 GMT
SAN=DNS:ngnl.host, DNS:models.ngnl.host, DNS:*.models.ngnl.host
```

curl 经本研究环境的本地 HTTPS egress proxy 访问时也得到：

```text
http_version=2
ssl_verify_result=0
response_code=200
```

其中 `remote_ip=127.0.0.1` 反映的是 harness 本地 egress proxy，不是源站地址；因此另用直连 `openssl s_client` 完成了上述独立证书验证。

- **判断**：当前没有证据支持域名级、证书过期、SAN 缺失或 Cloudflare TLS 配置错误；持久性 DNS/TLS 故障不是最可能根因。
- **置信度**：高（用户本地代理、杀软、Userscript 管理器或网络策略仍可能造成仅用户环境可见的 TLS/拦截问题）。
- **验证建议**：若部署修复 OPTIONS 后用户仍得到 `Failed to fetch`，再检查用户现场的证书链、代理/扩展拦截和 Network 面板 `net::ERR_*`；当前不应让这些次级可能性掩盖已确定的 405 preflight。

### 瞬态连接现象及解释边界

并行探测期间，本研究环境的 HTTPS egress proxy 曾出现一次 TLS `unexpected eof` 和一次 20 秒 timeout；串行、带 retry 的同一 OPTIONS 请求随后成功并稳定返回 405，两个 Cloudflare A 地址的直连 TLS 也都验证成功。

因此：

- 这些瞬态现象应记录，但不足以证明 endpoint 存在持续 TLS 故障；
- 确定性的 `OPTIONS 405` 在 HTTP/1.1 与 HTTP/2、两个 Origin 上均可复现；
- `Failed to fetch` 的首要解释仍是 CORS preflight 失败，而不是这两次研究环境代理抖动。

### 更新后的根因排序

1. **P0，已证实**：线上旧 Worker 对两个合法 Origin 的 Authorization preflight 都返回 405；这与 `Failed to fetch` 一一对应。
2. **P1，部署后再查**：新 deployment 的 KV namespace/entry 不一致。它只会在 preflight 通过、GET 实际发生后参与。
3. **P1，部署后再查**：real R2 object/manifest 漂移。它应产生 HTTP 200 后的大小/SHA 错误，而非当前的裸 `Failed to fetch`。
4. **P2，现场依赖**：用户本地 DNS/TLS、扩展拦截、代理或 Userscript 网络限制。本研究视角 DNS/TLS 正常；只有部署修复 OPTIONS 后仍失败，才应把它升为首要调查方向。

## 2026-07-27 生产恢复证据

### Deployment

- 目标 ref：`main`
- head SHA：`4a51f938052b8b233caf0c9ca59c9e35a683e46e`
- workflow run：<https://github.com/ngnlAYY/HV-PonySolver-JS/actions/runs/30237695547>
- inputs：`publish_model_worker=true`、`invalid_key_mode=decoy`
- `Deploy Worker` step：`success`
- Wrangler 上传时间：`2026-07-27T04:39:59Z`
- custom domain trigger 部署时间：`2026-07-27T04:40:01Z`
- Cloudflare Current Version ID：`18b98339-9be3-4e18-b769-ca4051d5c042`

未读取或输出 Cloudflare secret、KV namespace ID、R2 bucket credential 或模型 Key。

### 传播窗口与 checker 结果

`Verify deployed Worker contract` 在部署完成后立即开始，使用无 Key、无 body 的公开请求。最初 5 次尝试在 20 秒窗口内均观察到：

```text
OPTIONS origin=https://hentaiverse.org: status mismatch; expected=204 actual=403
```

因此 workflow conclusion 为 `failure`，但这不撤销已经成功的 Worker deployment。按既定边界没有自动回滚或自动二次部署。

部署约 55 秒后，从独立网络位置使用唯一 probe ID 复核，两个允许 Origin 均稳定满足：

```text
OPTIONS 204
Access-Control-Allow-Origin: <request Origin>
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
Access-Control-Allow-Headers: Authorization
Cache-Control: no-store
Vary: Origin

HEAD 200
Access-Control-Allow-Origin: <request Origin>
Cache-Control: no-store
Vary: Origin
```

随后以仓库 `check:deployment`、`attempts=1` 再次检查，输出：

```text
Model Worker deployment contract verified: attempt=1/1 mode=decoy origins=2
```

该证据证明当前公开 CORS/decoy 契约已恢复，但无 Key `HEAD 200` 不证明真实模型选择。生产观测同时证明原默认 5 次、5 秒间隔仅提供 20 秒传播窗口，不足以覆盖本次 Cloudflare edge 收敛；checker 默认值因此调整为 13 次尝试、5 秒间隔，即 60 秒有限窗口，并保留每请求 10 秒超时。该调整只更新后续 workflow 守卫，不执行第二次 Worker 部署。

### CodeQL 复扫

默认分支 Security Scan run <https://github.com/ngnlAYY/HV-PonySolver-JS/actions/runs/30237688682> 在 head `4a51f938052b8b233caf0c9ca59c9e35a683e46e` 成功完成。GitHub code-scanning alert #1（`js/client-side-unvalidated-url-redirection`）状态为 `fixed`，没有 dismiss；这验证了移除 Worker init 消息中的动态 `ortScriptUrl` 后，不可信消息值已不再流入 `importScripts` sink。

### 用户本地真实模型验收

2026-07-27，用户在被明确要求同时确认候选 Key验证、保存后的普通下载、完整性校验与缓存后回复“成功”。据此：

- 本地候选 Key验证成功；
- 保存后的普通下载成功；
- 真实模型通过 canonical byteLength/SHA-256 完整性校验并完成缓存；
- 未出现 HTTP `403`、大小/SHA 错误或持续 `Failed to fetch`，无需进入 KV/R2/DNS/TLS 次级分流；
- 用户没有向 AI 提供 Key，Key 未进入聊天、URL、日志或 task artifact。

生产公开契约、CodeQL、自动化回归与用户本地真实模型链路均已完成验收。
