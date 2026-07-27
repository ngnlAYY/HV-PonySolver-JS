# Research: 客户端授权模型下载链路

- **Query**: 研究 `model-config`、`App/settings callback`、`model-settings`、`model-downloader`、Userscript metadata grants/`@connect`、Tampermonkey/Violentmonkey 中标准 `fetch` 携带 `Authorization` 的跨域约束，以及相关测试/E2E 缺口；识别“正确 Key 仍无法下载”的最可能客户端根因与可验证复现步骤。
- **Scope**: mixed（仓库源码、测试、Trellis spec、官方外部文档、无真实 Key 的线上 HTTP 探测）
- **Date**: 2026-07-24
- **Secret handling**: 未读取、使用或输出任何真实 Key；浏览器探测仅使用临时虚构值，记录时只保留“是否存在 Authorization”这一布尔事实。

## 新增现场证据（2026-07-24）

- 用户设置 Key 后的验证提示明确包含 **`Failed to fetch`**，没有 HTTP status、响应大小或 SHA-256 错误。
- 这与 `downloadModel` 在 `await fetch(...)` 尚未取得 `Response` 时直接 reject 的分支吻合；若已收到 HTTP response，当前代码会报告 `模型下载失败: HTTP <status>`，若已进入 body/完整性阶段则会报告大小或 SHA-256 文案：`apps/userscript/src/model/model-downloader.ts:156-179`。
- 结合服务端已经独立确认线上 `OPTIONS 405`，根因置信度提升：浏览器在 `Authorization` preflight 阶段阻断请求，实际 Bearer GET 未发出。
- **`GM_xmlhttpRequest` 是否必要的判定**：它不是修复该问题的必选条件。当前架构选择标准 `fetch`，只要线上部署与源码一致地返回正确 `OPTIONS`/CORS headers 即可工作；`GM_xmlhttpRequest`/`GM.xmlHttpRequest` 是不依赖页面 same-origin policy 的另一种传输模型，只有决定不再依赖服务端 CORS 时才成为必要条件，并同时要求对应 grant、`@connect` 和 API 适配。当前 metadata 只有 `@connect`，没有 grant/use，因此现状不能获得该特权通道。

## 结论摘要

1. **Key 在客户端内部的传递链路没有发现“候选 Key 被旧 Key 覆盖”或“保存后普通下载不读取 Key”的证据。** 设置验证把当前候选值作为 `accessKeyOverride` 一路传至 `downloadModel`；普通缓存未命中路径则从 GM storage 读取已保存值。
2. **最可能的客户端失败边界是标准 `fetch` + `Authorization` 触发的 CORS preflight。** 当前 metadata 虽声明 `@connect models.ngnl.host`，但没有 `GM_xmlhttpRequest`/`GM.xmlHttpRequest` grant，代码也没有调用这类特权 API；因此 `@connect` 不会让当前标准 `fetch` 绕过 CORS。
3. **线上端点至少在本研究所经的 LAX 路径上与当前源码契约不一致，足以让正确 Key 在发送前失败。** 2026-07-24 多次无密钥 `OPTIONS` 探测返回 `405`、`Allow: GET, HEAD`，且缺少 `Access-Control-Allow-Methods`/`Access-Control-Allow-Headers`；浏览器因此可在 preflight 阶段阻止实际 GET，Bearer Key 根本不会到达 Worker。
4. **线上不一致具有网络路径差异。** 同日 headless Chromium 经 HKG 路径显示 preflight 可通过，但 GET 仍返回旧契约的 `Cache-Control: public, max-age=86400`；LAX 的 `HEAD` 也返回该旧缓存策略。当前源码和测试要求 `no-store`。因此仍需受影响用户的实际 DevTools Network 证据来判定其命中的是 preflight 失败，还是 GET 后返回旧/decoy 模型并在完整性阶段失败。
5. **现有自动化只能证明函数参数和 mock `fetch` header，不能证明真实 userscript manager、浏览器 CORS、线上 Worker、KV/R2 与模型完整性组成的整条链路。**

## Files Found

| File Path | Description |
|---|---|
| `apps/userscript/src/model/model-config.ts` | 固定模型 URL、空内置 Key、缓存名及 manifest 完整性配置 |
| `apps/userscript/src/app/app.ts` | 注册统一设置菜单；候选 Key 验证下载与缓存回调 |
| `apps/userscript/src/userscript/settings-menu.ts` | 顶层设置菜单把验证 callback 交给模型 Key 输入流程 |
| `apps/userscript/src/model/model-settings.ts` | Key 输入、trim、验证成功后保存、失败保留旧值 |
| `apps/userscript/src/userscript/gm-bridge.ts` | legacy GM storage/menu API 与 localStorage fallback |
| `apps/userscript/src/model/model-cache.ts` | 候选 override 转发、普通下载与缓存 |
| `apps/userscript/src/model/model-downloader.ts` | Key 选择、Bearer header、标准 `fetch`、响应大小与完整性检查 |
| `apps/userscript/src/inference/onnx-worker-client.ts` | 普通缓存未命中后的下载入口 |
| `apps/userscript/src/userscript/metadata.ts` | Userscript grants 与 `@connect` 声明 |
| `apps/model-worker/src/request-router.ts` | 当前源码中的 `OPTIONS` 路由 |
| `apps/model-worker/src/model-response.ts` | 当前源码中的 preflight/CORS header 契约 |
| `apps/userscript/test/model/model-downloader.test.ts` | mock `fetch` 下的 saved/override Bearer header 测试 |
| `apps/userscript/test/model/model-settings.test.ts` | GM/localStorage、验证后保存、验证失败保留旧值测试 |
| `apps/userscript/test/model/model-cache.test.ts` | `accessKeyOverride` 转发测试 |
| `apps/userscript/test/app/app.test.ts` | App 设置 callback 参数及缓存行为测试 |
| `apps/userscript/test/userscript/settings-menu.test.ts` | 顶层菜单到模型设置的 callback 测试 |
| `apps/userscript/test/userscript-metadata.test.ts` | 仅覆盖 HTTPS 页面匹配规则 |
| `apps/userscript/test/e2e/userscript-smoke.spec.ts` | 本地页面 + mock model cache/detector 的 Chromium smoke |
| `apps/userscript/scripts/build-userscript.test.mjs` | 构建产物中 GM storage/menu grants 的断言 |
| `apps/model-worker/test/index.test.ts` | 当前源码的 Bearer、allowed Origin、preflight 单元测试 |
| `.trellis/tasks/07-24-fix-authorized-model-download/prd.md` | 已确认事实、验收标准及尚缺的用户现场证据 |

## 客户端调用路径

### 1. 配置与设置入口

- `modelConfig.urlBase` 固定为 `https://models.ngnl.host/yolo26n-640.onnx`；内置 `accessKey` 为空，默认开启完整性校验：`apps/userscript/src/model/model-config.ts:3-10`。
- `App.init()` 注册统一设置菜单，并把 `candidateKey => verifyConfiguredModelKey(candidateKey)` 传入：`apps/userscript/src/app/app.ts:30-37`。
- 顶层菜单的“设置模型下载 Key” action 把 callback 传给 `setModelAccessKeyFromPrompt`：`apps/userscript/src/userscript/settings-menu.ts:26-37,46-55`。

### 2. 候选 Key 验证路径

1. 输入先 `trim()`；空输入清除 Key：`apps/userscript/src/model/model-settings.ts:25-35`。
2. 非空输入在保存前执行 `onVerify(accessKey)`；失败只显示错误并返回，成功后才调用 `setModelAccessKey`：`apps/userscript/src/model/model-settings.ts:36-49`。
3. `App.verifyConfiguredModelKey` 调用 `modelCache.download(undefined, true, candidateKey)`，成功后尝试缓存；缓存写失败不会把可下载的 Key 判为无效：`apps/userscript/src/app/app.ts:62-68`。
4. `ModelCache.download` 将第三参数封装成 `accessKeyOverride` 并传给 `downloadModel`：`apps/userscript/src/model/model-cache.ts:87-99`。
5. `getRequestAccessKey` 优先返回 trim 后的 override；只有 override 为空时才读取 GM storage，再回退至空的 `modelConfig.accessKey`：`apps/userscript/src/model/model-downloader.ts:31-43`。

### 3. 保存后的普通下载路径

1. 缓存未命中时，`OnnxWorkerClient.loadModelBuffer` 调用 `modelCache.download(abortController.signal)`，不传 override：`apps/userscript/src/inference/onnx-worker-client.ts:134-142`。
2. `ModelCache.download` 因 override 为 `undefined`，只传 `{ verifyIntegrity }`：`apps/userscript/src/model/model-cache.ts:87-99`。
3. `downloadModel` 通过 `getModelAccessKey()` 读取保存值：`apps/userscript/src/model/model-downloader.ts:31-43`。
4. `getModelAccessKey` 走 `getGmValue`；存在 `GM_getValue` 时 await 它，否则才用 localStorage：`apps/userscript/src/model/model-settings.ts:8-14`、`apps/userscript/src/userscript/gm-bridge.ts:40-65`。

### 4. HTTP 与完整性路径

- 非空 Key 被设置成 `authorization: Bearer <key>`；请求使用标准全局 `fetch`、`cache: 'no-store'` 和 abort signal：`apps/userscript/src/model/model-downloader.ts:45-50,156-168`。
- HTTP 非 2xx 仅报告状态；HTTP 200 后还会校验 `Content-Length`、实际最大字节数和 manifest SHA-256：`apps/userscript/src/model/model-downloader.ts:53-154,168-179`。
- 因此三类现场表现不同：
  - preflight/CORS 阻断：`fetch` reject，通常是 `TypeError: Failed to fetch`，GET 不会发送；
  - Worker 明确拒绝：GET 可见且返回 403，客户端报告 `模型下载失败: HTTP 403`；
  - 旧 Worker、decoy 或错误 R2 object 返回 200：随后在大小/SHA-256 阶段失败。

## Findings（含置信度与验证建议）

### F1. `@connect` 对当前标准 `fetch` 不提供跨域豁免

- **Evidence**:
  - metadata 仅 grant 菜单与 GM storage；声明了 `@connect cdn.jsdelivr.net` 和 `@connect models.ngnl.host`，但没有 grant `GM_xmlhttpRequest` 或 `GM.xmlHttpRequest`：`apps/userscript/src/userscript/metadata.ts:12-18`。
  - 下载调用是标准 `fetch(...)`：`apps/userscript/src/model/model-downloader.ts:156-168`。
  - `gm-bridge` 类型和实现中也没有任何 GM HTTP API：`apps/userscript/src/userscript/gm-bridge.ts:5-10,40-100`。
  - Tampermonkey 官方文档将 `@connect` 明确定义为“允许由 `GM_xmlhttpRequest` 获取的域”；Violentmonkey 官方文档把 `GM_xmlhttpRequest` 描述为“不受 same-origin policy 限制”的特权请求。
- **Interpretation**: 当前传输仍是 Web Fetch/CORS 模型；metadata 中的 `@connect` 本身不能修复标准 `fetch` 的 preflight。
- **Confidence**: **高（0.99）**。
- **Validation suggestion**: 在 Tampermonkey 与 Violentmonkey 各自的已安装脚本中查看 Network；当前实现应显示页面发起的 `fetch`/`OPTIONS`，而不是 userscript manager background 发起的 GM request。只记录 header 名与状态，不复制 `Authorization` 值。

### F2. Bearer header 必然使跨域标准 `fetch` 依赖成功 preflight

- **Evidence**:
  - `Authorization` 在请求初始化中显式加入：`apps/userscript/src/model/model-downloader.ts:45-50`。
  - MDN CORS 文档明确指出，由 `Authorization` header 触发的请求会 preflight；浏览器先发 `OPTIONS`，服务端必须允许 origin、method 和 header。
  - 当前 Worker 源码确实为该约束设置 `OPTIONS` 路由：`apps/model-worker/src/request-router.ts:5-23`；preflight 声明 `Authorization` 与 `GET, HEAD, OPTIONS`：`apps/model-worker/src/model-response.ts:7-10,57-67`。
- **Interpretation**: 即使 Key 完全正确，只要 `OPTIONS` 失败，Bearer GET 就不会发送，KV 不可能看到 Key。
- **Confidence**: **高（0.99）**。
- **Validation suggestion**: DevTools 中确认顺序应为 `OPTIONS` → `GET`；若只有失败的 `OPTIONS`，即可将失败定位在授权解析之前。

### F3. 线上 LAX 路径重复返回旧的、不能满足 Bearer preflight 的契约

- **Evidence**:
  - 非密钥 preflight 探测（只发送 header 名，不含 Key）在 2026-07-24 08:19、08:23、08:27、08:29 UTC+0 所见 LAX 路径重复返回：`405`、`Allow: GET, HEAD`、`Access-Control-Allow-Origin: *`，但无 `Access-Control-Allow-Methods` 与 `Access-Control-Allow-Headers`。
  - 当前源码预期 `204` 以及 `Authorization`/`GET, HEAD, OPTIONS`：`apps/model-worker/src/request-router.ts:18-23`、`apps/model-worker/src/model-response.ts:57-67`。
  - 当前 Worker 单元测试也锁定 `204`、allowed Hentaiverse origin、`Authorization`、`no-store`：`apps/model-worker/test/index.test.ts:312-329`。
- **Interpretation**: 对命中该路径的真实浏览器，最符合“正确 Key 仍不能下载”的故障是 preflight 405；这是由客户端选择标准 Bearer `fetch` 暴露出的部署契约依赖，而不是 Key 内容错误。
- **Confidence**: **高（0.99）**；`Failed to fetch` 与已确认的线上 `OPTIONS 405` 相互印证，仍需 Network trace/CF-Ray 确认报告者命中的具体边缘路径。
- **Validation suggestion**: 使用下文无密钥 `curl OPTIONS` 复现；再与报告者实际浏览器的 CF-Ray/状态对照。

### F4. 线上响应还显示旧缓存契约，说明通过 preflight 也不等于 Bearer 链路已部署

- **Evidence**:
  - 2026-07-24 LAX 的无密钥 `HEAD` 返回 `Cache-Control: public, max-age=86400` 和 `Access-Control-Allow-Origin: *`。
  - 同日一次 Chromium HKG 路径的 GET 也返回 `Cache-Control: public, max-age=86400`。
  - 当前客户端要求 `cache: 'no-store'`：`apps/userscript/src/model/model-downloader.ts:45-50`；当前 Worker 响应固定 `Cache-Control: no-store`：`apps/model-worker/src/model-response.ts:4,45-54,70-81`；对应测试断言 `no-store`：`apps/model-worker/test/index.test.ts:99-118`。
- **Interpretation**: 至少部分线上响应并非当前 Bearer/no-store 源码契约。即使某网络路径让 preflight 通过，旧 Worker 仍可能忽略 Bearer 或返回旧/decoy object，最终由客户端完整性检查拒绝。
- **Confidence**: **高（0.98）**（对“线上契约不一致”）；具体返回的是 real/decoy 未在无真实 Key条件下判定。
- **Validation suggestion**: 在受影响浏览器检查 GET 的 `Cache-Control`、状态、`Content-Length` 与 CF-Ray；不查看或导出完整 `Authorization`。`public, max-age=86400` 可直接证明不是当前源码契约。

### F5. 候选 Key override 顺序不是当前最可能根因

- **Evidence**:
  - override 在读 storage 前返回：`apps/userscript/src/model/model-downloader.ts:31-43`。
  - App callback 直接传候选 Key：`apps/userscript/src/app/app.ts:62-68`。
  - 单元测试覆盖候选 Key 的 trim/header、且 storage Promise 永不完成时仍立即 fetch：`apps/userscript/test/model/model-downloader.test.ts:62-78,107-137`。
  - App 测试覆盖 callback → `download(undefined, true, candidateKey)`：`apps/userscript/test/app/app.test.ts:120-145`。
  - ModelCache 测试覆盖 override 转发：`apps/userscript/test/model/model-cache.test.ts:297-310`。
- **Interpretation**: 当前源码不会在首次验证时误用旧的已保存 Key。
- **Confidence**: **高（0.99）**。
- **Validation suggestion**: 浏览器 Network 仅验证 GET 是否“存在 Authorization header”，不要复制值；若 preflight 已失败，则 header 只会出现在 `Access-Control-Request-Headers: authorization`，实际 GET 不存在。

### F6. 保存后普通下载会读取 GM storage，但现有测试没有跨模块真实 manager 集成

- **Evidence**:
  - 普通缓存未命中不传 override：`apps/userscript/src/inference/onnx-worker-client.ts:134-142`。
  - downloader 随后读取 GM storage：`apps/userscript/src/model/model-downloader.ts:31-43`。
  - storage 单测使用 mock `GM_getValue`/`GM_setValue`/`GM_deleteValue`：`apps/userscript/test/model/model-settings.test.ts:38-54`。
  - downloader 单测把整个 `model-settings` 模块 mock 掉：`apps/userscript/test/model/model-downloader.test.ts:3-9`。
- **Interpretation**: 源码路径正确，但目前没有测试证明“真实 manager 保存 → 页面刷新/缓存失效 → downloader 读取 → 浏览器网络请求”是一个连续场景。
- **Confidence**: **高（0.98）**。
- **Validation suggestion**: 在隔离测试 profile 中先成功保存测试 Key；只删除 IndexedDB `pony-solver-local` 的模型缓存而保留 GM storage，再刷新触发普通下载，并检查新的 `OPTIONS`/GET。不要在共享 profile 操作。

### F7. 当前 UI 无法从 `TypeError: Failed to fetch` 区分 CORS、DNS、TLS、CSP 或离线

- **Evidence**:
  - `downloadModel` 没有包装 `fetch` rejection，只对拿到的 HTTP response 做 status 分类：`apps/userscript/src/model/model-downloader.ts:156-179`。
  - 设置流程把任意异常统一显示为 `模型下载 Key 验证失败: <formatted error>`：`apps/userscript/src/model/model-settings.ts:41-49`。
  - `formatErrorMessage` 只拼接 error name/message：`apps/userscript/src/utils/errors.ts:10-25`。
  - PRD 明确记录“具体浏览器错误文本和 Network 响应尚未取得”：`.trellis/tasks/07-24-fix-authorized-model-download/prd.md:7-16,46-50`。
- **Interpretation**: 用户看到“验证失败”不等于 Worker 判定 Key 无效；CORS preflight 失败会被同一文案包裹。
- **Confidence**: **高（0.99）**。
- **Validation suggestion**: 以 Network 的 `OPTIONS`/GET 阶段和状态为主证据，弹窗文本仅作为辅助，并先遮盖任何潜在敏感值。

### F8. `Content-Length` 读取本身不是最可能的跨域阻断点

- **Evidence**:
  - 客户端在 response 后读取 `content-length`：`apps/userscript/src/model/model-downloader.ts:84-103`。
  - `Content-Length` 属于 CORS-safelisted response headers；不需要 Worker 额外 `Access-Control-Expose-Headers` 才能读取。
- **Interpretation**: 当前未设置 `Access-Control-Expose-Headers` 不足以解释“正确 Key 无法下载”；更早的 preflight 或更后的完整性错误更符合证据。
- **Confidence**: **高（0.95）**。
- **Validation suggestion**: 在 GET 已成功时检查代码实际读取到的 declared length 与下载字节数；不要把缺失的非 safelisted response header 误归为本问题。

## Metadata / Userscript manager 约束

### 当前 metadata 事实

```text
@grant GM_registerMenuCommand
@grant GM_getValue
@grant GM_setValue
@grant GM_deleteValue
@connect cdn.jsdelivr.net
@connect models.ngnl.host
```

来源：`apps/userscript/src/userscript/metadata.ts:12-18`。

- 未声明 `GM_xmlhttpRequest` 或 `GM.xmlHttpRequest` grant。
- `@connect models.ngnl.host` 对 Tampermonkey 的语义是允许 GM HTTP API 访问该域；当前下载未使用该 API。
- Tampermonkey 文档还说明未指定 `@sandbox` 时当前默认 `raw`/`MAIN_WORLD`；当前 metadata 没有 `@sandbox`：`apps/userscript/src/userscript/metadata.ts:1-19`。无论执行于 page world 还是 fallback sandbox，当前代码调用的仍是标准 `fetch`，其跨域响应受 Fetch/CORS 控制。
- Violentmonkey 默认在存在 grants 时启用 sandbox；其官方 API 将 `GM_xmlhttpRequest`/`GM.xmlHttpRequest` 明确列为拥有 special capabilities、可越过 same-origin policy 的特权通道。当前代码没有调用它。

## Test Coverage Matrix / Gaps

| Boundary | Existing coverage | What remains unproven |
|---|---|---|
| 候选 Key → App callback | `apps/userscript/test/app/app.test.ts:95-145` | 使用真实顶层菜单与真实 ModelCache 的浏览器场景 |
| 菜单 trim/验证后保存 | `apps/userscript/test/model/model-settings.test.ts:150-210`; `apps/userscript/test/userscript/settings-menu.test.ts:50-89` | 真实 Tampermonkey/Violentmonkey storage 与菜单生命周期 |
| saved/override Bearer header | `apps/userscript/test/model/model-downloader.test.ts:46-78,107-137` | 测试用 `vi.stubGlobal('fetch')`，不会产生 OPTIONS，也不会执行浏览器 CORS |
| ModelCache override | `apps/userscript/test/model/model-cache.test.ts:297-310` | `downloadModel` 被 mock，未连到网络 |
| 普通缓存未命中 | `apps/userscript/test/inference/onnx-worker-client.test.ts:29-68` | ModelCache 整体被 mock，不会读取 GM storage 或 fetch |
| Metadata | `apps/userscript/test/userscript-metadata.test.ts:5-11` | 只断言 HTTPS include；不检查 `@connect` 与网络 API grant/use 一致性 |
| 构建产物 metadata | `apps/userscript/scripts/build-userscript.test.mjs:128-139` | 断言四个菜单/storage grants，但不执行已安装 `.user.js`，也不验证跨域权限行为 |
| Worker CORS | `apps/model-worker/test/index.test.ts:244-347` | 仅 in-memory Worker；不能证明线上部署、区域边缘、route/binding 与源码一致 |
| Userscript E2E | `apps/userscript/test/e2e/userscript-smoke.spec.ts:14-140` | 用 `page.addScriptTag` 注入选定模块；`modelCache.download` 与 detector 均 mock（`104-123`）；没有安装 userscript manager、没有 metadata/grants/GM storage、没有模型 fetch/Authorization/OPTIONS/完整性/IndexedDB；只跑 Chromium（`apps/userscript/playwright.config.ts:10-15`） |

Focused unit tests executed during this research:

```text
5 test files passed; 67 tests passed
model-downloader, model-settings, app, settings-menu, userscript-metadata
```

这证明当前函数级断言通过，但不覆盖上述运行时边界。

## 可验证复现步骤

### A. 无真实 Key 的 preflight 探测

以下命令不包含任何 Key，只声明浏览器计划发送的 header 名：

```bash
curl --request OPTIONS \
  'https://models.ngnl.host/yolo26n-640.onnx' \
  --header 'Origin: https://hentaiverse.org' \
  --header 'Access-Control-Request-Method: GET' \
  --header 'Access-Control-Request-Headers: authorization' \
  --dump-header - --output /dev/null
```

当前源码契约应看到：

```text
204
Access-Control-Allow-Origin: https://hentaiverse.org
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
Access-Control-Allow-Headers: Authorization
Cache-Control: no-store
```

本研究的 LAX 路径实际重复看到：

```text
405
Allow: GET, HEAD
Access-Control-Allow-Origin: *
（无 Access-Control-Allow-Methods）
（无 Access-Control-Allow-Headers）
```

判定：该结果足以让标准浏览器拒绝后续带 Bearer 的 GET。

### B. 受影响浏览器中的最小现场复现

1. 使用隔离 profile，记录浏览器、Tampermonkey/Violentmonkey 及其版本。
2. 打开脚本匹配的 `https://hentaiverse.org/*` 或 `https://alt.hentaiverse.org/*` 页面，开启 DevTools Network、Preserve log，并禁用 DevTools cache。
3. 从 Userscript 菜单进入“HV-PonySolver 设置”→“设置模型下载 Key”，输入已知有效的测试 Key。不要录屏、复制 request headers 或导出包含完整 `Authorization` 的 HAR。
4. 过滤 `models.ngnl.host/yolo26n-640.onnx`：
   - **只有 OPTIONS，状态 405/失败，GET 不存在**：确认 F2/F3；Key 尚未到 Worker。
   - **OPTIONS 204 后 GET 403**：CORS 已过，失败位于 Bearer/KV 授权层。
   - **OPTIONS 204 后 GET 200，但随后出现大小或 SHA-256 错误**：失败位于 decoy/旧 Worker/R2 object/manifest 层。
   - **GET headers 出现 `Cache-Control: public, max-age=86400`**：命中旧线上契约，不是当前源码的 `no-store` 行为。
5. 若首次验证成功，要验证保存后普通路径：保留 GM storage，仅在该隔离 profile 中删除 IndexedDB `pony-solver-local` 的模型缓存，然后刷新并触发一次验证码；确认新的下载仍产生 Bearer GET。检查“header 是否存在”即可，不查看值。
6. 记录失败 request 的 status、response headers、CF-Ray、浏览器控制台错误文本（遮盖敏感值）和发生阶段。

### C. Tampermonkey 与 Violentmonkey 的差异验证

- 对同一页面、同一脚本构建、同一无敏感信息的 Network 观察分别运行一次。
- 当前实现两者都应走标准 `fetch`；若结果不同，优先记录实际执行 sandbox/injection mode、OPTIONS 是否发送、Origin 值及 manager 版本。
- metadata 的 `@connect` 不能作为“标准 fetch 已获得跨域权限”的验证结论；它只与 GM HTTP 特权通道相关。

## External References

- [Tampermonkey `@connect`](https://www.tampermonkey.net/documentation.php?locale=en#meta:connect) — 官方定义：列出允许由 `GM_xmlhttpRequest` 获取的域，初始与最终 URL 都会检查。
- [Tampermonkey `GM_xmlhttpRequest`](https://www.tampermonkey.net/documentation.php?locale=en#api:GM_xmlhttpRequest) — 支持自定义 headers、`arraybuffer`、abort；请求由 Tampermonkey background context 调度，并要求同时检查 `@connect`。
- [Tampermonkey `@sandbox`](https://www.tampermonkey.net/documentation.php?locale=en#meta:sandbox) — 描述 MAIN_WORLD、ISOLATED_WORLD、USERSCRIPT_WORLD 以及省略时的 raw 默认/fallback。
- [Violentmonkey privileged APIs: `GM_xmlhttpRequest`](https://violentmonkey.github.io/api/gm/#gm_xmlhttprequest) — 官方说明该 API 具有 special capabilities，且不受 same-origin policy 限制；也列出 `GM.xmlHttpRequest` Promise alias。
- [Violentmonkey metadata / grants](https://violentmonkey.github.io/api/metadata-block/#grant) — 描述 grant 与 sandbox/injection 语义。
- [MDN CORS guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS#preflighted_requests) — 标准 `fetch` 的 preflight 流程、`Access-Control-Allow-*` 检查以及 `Authorization` 导致 preflight 的约束。
- [MDN CORS-safelisted response header](https://developer.mozilla.org/en-US/docs/Glossary/CORS-safelisted_response_header) — `Content-Length` 属于默认可暴露 response headers。

## Related Specs

- `.trellis/spec/userscript/frontend/quality-guidelines.md:1-51` — 测试要求仍是 “To be filled by the team”，没有针对 Userscript manager、CORS 或模型下载的项目约束。
- `.trellis/spec/userscript/frontend/hook-guidelines.md:1-51` — Data Fetching 部分仍是占位内容，没有规定标准 `fetch` 与 GM HTTP API 的边界。
- `.trellis/tasks/07-24-fix-authorized-model-download/prd.md:18-36` — 当前任务要求区分 CORS、HTTP 授权、响应大小、SHA-256 与存储阶段，并要求真实浏览器 smoke/E2E 证据。

## Caveats / Not Found

1. 已知报告者错误为 `Failed to fetch`，但仍未获得其 Network request chain、OPTIONS status/headers 或 CF-Ray；因此可以高置信定位到 fetch/CORS 网络边界，尚不能仅凭弹窗确认其具体边缘路径。
2. 本环境没有安装可直接自动化的 Tampermonkey/Violentmonkey 扩展；现有 Playwright smoke 也不加载扩展。
3. Headless Chromium 探测与 `curl` 命中了不同网络路径：Chromium HKG 路径显示 preflight 通过，而 LAX `curl` 重复 405；两者 GET/HEAD 都暴露旧的 `public, max-age=86400` 契约。区域、代理、preflight cache 或边缘路径差异尚未完全区分。
4. 未使用真实 Key，因此没有判断线上 KV 中某一具体 Key 是否命中，也没有判断 200 响应体究竟是 real 还是 decoy。
5. 未下载或输出线上模型体；浏览器探测在收到 response 后取消 body，线上检查主要依赖状态与响应 headers。


---

## 服务端交叉验证补充（2026-07-24 任务结束记录）

### 是否有新增客户端代码结论

**没有发现新的客户端 Key 传递、保存或 Bearer header 构造缺陷。** 新增证据只进一步确认既有 F2/F3 的网络失败边界：`Failed to fetch` 发生在 `await fetch(...)` 尚未取得可用 `Response` 时；若已经取得响应，客户端会进入 HTTP status、byteLength 或 SHA-256 的明确错误分支（`apps/userscript/src/model/model-downloader.ts:156-179`）。因此当前无需把首要修复转向 Key storage、override 顺序或 `GM_xmlhttpRequest`。

### 双 Origin 与协议复核

服务端只读研究以无 Key、无 response body 的请求补充确认：

- `Origin: https://hentaiverse.org`：Authorization preflight 在 HTTP/1.1 与 HTTP/2 均返回 `405`、`Allow: GET, HEAD`、`Access-Control-Allow-Origin: *`，缺少 `Access-Control-Allow-Headers: Authorization`。
- `Origin: https://alt.hentaiverse.org`：同样返回 `405` 与相同缺失 headers。
- 两个 Origin 的无授权 `HEAD` 均返回同一旧指纹：`Cache-Control: public, max-age=86400`、同一 decoy ETag。

这排除了“只有某一个 Hentaiverse Origin 漏配”的解释；至少在复核的 LAX 路径上，线上 Worker 整体仍是 OPTIONS/Bearer 改造前契约。此前记录的 Chromium HKG 路径差异仍保留为 caveat，说明用户现场的 CF-Ray/Network chain 对定位具体边缘路径仍有价值，但不改变“线上部署必须统一更新到当前契约”的结论。

### DNS/TLS 排除结果

- `models.ngnl.host` 正常解析到 Cloudflare A 地址 `172.67.187.70` 与 `104.21.80.217`。
- 两个地址直连均完成 TLS 1.3，hostname verification 为 `OK`。
- 证书 SAN 包含 `models.ngnl.host`，有效期为 2026-07-16 至 2026-10-14。
- 并行探测时研究环境 egress proxy 曾出现瞬态 EOF/timeout，但串行 retry、HTTP/2 及两个 Cloudflare 地址的直连 TLS 都成功；确定性的 OPTIONS 405 可重复。

**结论**：从研究网络视角，没有证据支持持续 DNS、证书过期、SAN 或 Cloudflare TLS 配置问题。若部署当前 Worker 后用户仍得到 `Failed to fetch`，再升级调查用户本地代理、扩展/Userscript manager 拦截、DNS 与浏览器 `net::ERR_*`；当前首要根因仍是已确认的 CORS preflight 405。

完整的 endpoint、DNS/TLS、workflow、KV/R2 与安全验证证据见：`.trellis/tasks/07-24-fix-authorized-model-download/research/server-auth-deployment.md`。
