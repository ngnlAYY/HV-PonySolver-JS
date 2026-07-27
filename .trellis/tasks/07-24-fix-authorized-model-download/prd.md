# 修复授权模型下载失败

## Goal

恢复有效模型下载 Key 的线上 Bearer 下载链路，并增加发布后公开 HTTP/CORS 契约守卫，防止“验证与 dry-run 全绿，但线上仍运行旧 Worker”的部署漂移再次导致浏览器 `Failed to fetch`。整个过程不得暴露真实 Key，也不得削弱模型完整性校验。

## Background and Confirmed Facts

- 用户在 Userscript 设置其确认正确的 Key 时收到 `Failed to fetch`，而不是 HTTP status、响应大小或 SHA-256 错误；失败发生在浏览器取得可用 `Response` 之前。
- Key 设置链路当前正确：输入先 `trim()`，候选 Key 通过 `accessKeyOverride` 验证，成功后才保存到 GM storage，不会被旧 Key 覆盖（`apps/userscript/src/model/model-settings.ts:4-49`、`apps/userscript/src/model/model-downloader.ts:31-43`）。
- 当前下载使用标准跨域 `fetch`，非空 Key 通过 `Authorization: Bearer <key>` 发送；`Authorization` 会触发浏览器 CORS preflight（`apps/userscript/src/model/model-downloader.ts:45-50,156-179`）。
- 无 Key、无响应体的公开探测已确认线上 `models.ngnl.host` 契约陈旧：`OPTIONS` 返回 `405 Method Not Allowed`、`Allow: GET, HEAD`，且缺少 `Access-Control-Allow-Headers: Authorization`；无授权 `HEAD` 仍返回 `Cache-Control: public, max-age=86400`。
- 当前源码要求 `OPTIONS 204`、`Allow: GET, HEAD, OPTIONS`、允许 `Authorization`、回显允许的 Hentaiverse Origin，以及 `Cache-Control: no-store`。线上行为证明至少相关边缘路径仍运行 Bearer/OPTIONS 改造前的旧 Worker。
- 已探测的两个合法 Origin/LAX 网络路径均确认 preflight 失败，且与用户的 `Failed to fetch` 高度吻合；尚未取得用户现场 CF-Ray，因此不把某一具体边缘路径当作既成事实。无论边缘差异如何，公开响应的旧 cache/HTTP 指纹都证明线上部署未统一到当前契约。
- 最近且唯一可见的 Model Worker GitHub workflow run 完成了 render、test 和 Wrangler dry-run，但 `Deploy Worker` step 明确为 `skipped`；workflow 总体 `success` 不代表发布成功。
- 当前 `origin/main` 已包含正确 Worker 运行时代码；当前开发分支相对 `origin/main` 的额外提交不改变 Worker runtime，因此可从 `main` 恢复服务。
- 现有本地 `corepack pnpm check` 通过，但 mock KV/R2 和单元测试不能证明线上 deployment、binding 或 R2 artifact 正确。

## Requirements

### R1 — 恢复线上契约

在单独取得生产部署确认后，从包含当前 Worker runtime 的 `main` 实际发布 Model Worker；必须验证 `Deploy Worker` step 成功并能关联到新 deployment，不能以 dry-run 或 workflow 总体绿色代替。

### R2 — 保持客户端安全边界

保持标准 `fetch`、Bearer header、GM storage 和当前候选 Key 验证顺序。不得改回 query string、关闭浏览器安全检查或改用绕过 CORS 的特权网络 API来掩盖旧部署。

### R3 — 增加无秘密发布后检查器

新增可测试的 Node.js ESM 检查器，在不发送 Key、不读取模型 body 的情况下，对 `https://hentaiverse.org` 和 `https://alt.hentaiverse.org` 分别验证 OPTIONS/HEAD 契约。允许 methods/header 必须按规范化 token 集合精确匹配，不能接受额外授权面；检查必须兼容 `INVALID_KEY_MODE=decoy` 和 `error`。

### R4 — 接入部署 workflow

公开契约检查仅在实际 deploy 后运行；状态或关键 header 不符、网络失败或重试耗尽时，deploy job 必须失败且输出可定位的 method、Origin、status/header 差异。不得使用 `continue-on-error`。

### R5 — 处理部署传播

检查器应使用非秘密唯一 probe ID 避免旧 public cache 影响，并提供有限次数、固定间隔的传播重试。不得无限轮询或自动执行第二次生产部署/回滚。

### R6 — 保持授权与模型完整性

只有 KV 命中的有效 Bearer token 可以选择真实模型；无效 token 继续遵循 decoy/`403` 策略。真实 R2 object 仍须匹配 canonical manifest 的 version、byteLength 和 SHA-256；不得通过关闭完整性校验接受未知模型。

### R7 — 更新运维说明

README 和 Model Worker 运维文档必须明确区分 dry-run、实际 deploy、公开 OPTIONS/HEAD 验收、用户本地 Key 验证以及后续 KV/R2/manifest 排查顺序。

### R8 — 回归验证

新增检查器必须使用注入的 `fetch`/`sleep` 完成离线自动化测试；现有 Userscript Key/Bearer、Worker CORS/KV/R2、docs drift 和完整项目检查必须保持通过。

### R9 — 修复 CodeQL 动态 Worker URL 告警

关闭 GitHub code-scanning alert #1（`js/client-side-unvalidated-url-redirection`）：ONNX Worker 初始化消息不得携带可变 `ortScriptUrl` 并直接传给 `importScripts`。Worker 必须从仓库 canonical ONNX Runtime asset 配置读取固定 URL；客户端/Worker 消息类型、构造与测试同步更新。不得通过 CodeQL dismiss、字符串 allowlist 接受任意同源/HTTPS URL或关闭扫描替代代码修复。

## Acceptance Criteria

- [ ] **AC1 / R1**：GitHub workflow 的 `Deploy Worker` step 为 `success`，并记录 run URL、head SHA 及可获得的新 Cloudflare deployment 标识或时间。
- [ ] **AC2 / R3-R5**：发布后检查器覆盖 decoy/error 成功路径、两个允许 Origin、旧 `OPTIONS 405`、缺失/陈旧 CORS header、错误 cache/vary、网络失败、重试成功与重试耗尽。
- [ ] **AC3 / R3-R4**：workflow 仅在 `publish_model_worker=true` 且 deploy 实际执行后运行检查器；检查器不接收 Cloudflare credential、KV/R2 标识或模型 Key。
- [ ] **AC4 / R1-R5**：线上两个允许 Origin 均返回 `OPTIONS 204`、对应 `Access-Control-Allow-Origin`、`Access-Control-Allow-Methods: GET, HEAD, OPTIONS`、`Access-Control-Allow-Headers: Authorization`、`Cache-Control: no-store`，且 `Vary` 包含 `Origin`。
- [ ] **AC5 / R3-R6**：无 Key HEAD 在 decoy 模式返回 `200`、在 error 模式返回 `403`；两者均保持允许 Origin、`no-store` 和 `Vary: Origin`，且检查不下载 response body。
- [ ] **AC6 / R2-R6**：用户在本地重新验证其 Key 后，首次验证与保存后的普通下载均成功取得、完整性校验并缓存真实模型；用户无需向 AI 提供 Key。
- [ ] **AC7 / R2-R6**：现有自动化继续证明候选/保存 Key 使用 Bearer header、KV 命中选择 real、无效 Key遵循 decoy/error、错误模型不能进入缓存或 ONNX session。
- [ ] **AC8 / R7**：文档说明绿色 dry-run 不代表部署，并提供部署、公开验收、用户验证、次级 KV/R2 检查和人工回滚步骤。
- [ ] **AC9 / R8**：`corepack pnpm check` 完整通过，且测试过程不访问公网。
- [ ] **AC10 / 全部**：代码、测试、日志、workflow、task artifact 和命令输出均不包含真实 Key 或其他生产 credential。
- [ ] **AC11 / R9**：`WorkerInitRequest`/worker 入口不再接受动态 `ortScriptUrl`；canonical URL 的远程 runtime 初始化与 bundled-runtime 路径测试通过，默认分支 CodeQL 复扫后 alert #1 自动关闭或不再出现在开放告警中。

## Out of Scope

- 重设计 Key签发、轮换、账户或权限体系。
- 改用 `GM_xmlhttpRequest`/`GM.xmlHttpRequest` 或增加新的跨域特权 grant。
- 通过 query string 传输 Key。
- 放宽 Worker 缓存策略、引入共享缓存或取消 `Cache-Control: no-store`。
- 取消模型完整性校验或更新 manifest 来接受未经验证的线上 artifact。
- 本次根因修复之外的通用客户端网络错误 UI 重构。
- 与模型下载无关的验证码识别精度、答题逻辑或界面重构。

## Key Decisions

- 用户选择“恢复并加守卫”：先恢复当前 Bearer/OPTIONS 服务，再增加 workflow 发布后公开契约检查。
- 修复服务端部署漂移，不绕过浏览器 preflight。
- 默认保持 `INVALID_KEY_MODE=decoy`；改变生产模式需要重新确认。
- 生产部署是外部可见操作：即使用户批准实现，也必须在实际触发 workflow 前再次明确确认。
- 发布后检查失败不自动回滚；先保留证据，再由用户决定是否通过 Cloudflare deployment history 回滚。

## Post-deployment Evidence Gates and Risks

这些项目不阻塞设计收敛，但属于任务验收：

- 发布后由用户在本地菜单重新验证 Key，Key 不进入聊天、URL、日志或测试。
- 若 preflight 已修复但出现 HTTP `403`，核对 deployed `INVALID_KEY_MODE`、KV binding target 和该 Key entry。
- 若 HTTP `200` 后出现大小/SHA-256 错误，核对 real/decoy object 选择，并确认 `real/yolo26n-640.onnx` 为 9809075 bytes且 SHA-256 匹配 canonical manifest。
- GitHub runner 的单一网络位置不能证明所有 Cloudflare edge 同时一致；唯一 probe ID、有限重试和用户现场验证共同构成验收证据。
- 检查器在 deploy 之后运行，因此失败代表生产变更可能已经发生；不得把 job failure 误解为“没有部署”。
