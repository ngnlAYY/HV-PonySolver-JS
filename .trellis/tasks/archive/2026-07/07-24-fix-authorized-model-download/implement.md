# 修复授权模型下载失败：执行计划

> 当前为规划文件。未执行生产部署，未修改产品代码，任务尚未 `start`。

## Gate 0：进入实现前

- [x] 用户已要求继续完成任务，并于 2026-07-27 明确选择“先加守卫再部署”。
- [x] 任务状态为 `in_progress`，当前分支 `fix/authorized-model-download`。
- [x] 已加载 `trellis-before-dev`、model-worker/shared 指引与任务 research。
- [x] 已确认分支快进到 `origin/chore/optimization-round2` 的已验证基线，工作区仅有不相关 Trellis scaffold 未跟踪文件。
- [x] 生产部署已独立确认：守卫实现并集成 main 后，以 `publish_model_worker=true`、`invalid_key_mode=decoy` 执行一次部署。

## Stage 1：恢复线上服务（主代理操作，生产部署确认门）

### 1.1 部署前

- [x] 用户已确认目标环境、ref（`main`）、`publish_model_worker=true` 和 `invalid_key_mode=decoy`。
- [x] 记录部署前公开契约指纹：OPTIONS `405`、旧 `Allow: GET, HEAD`、旧 public cache；未发送 Key、未下载 body。
- [x] GitHub Actions secrets gate 返回 ready；未读取或输出 secret 值。

### 1.2 执行发布

- [x] 从 GitHub Actions 在 `main` ref 触发 `Deploy Cloudflare Model Worker`。
- [x] 显式传入 `publish_model_worker=true`。
- [x] 传入 `invalid_key_mode=decoy`。
- [x] workflow run `30237695547` 的 `Deploy Worker` step 为 `success`；发布后 checker 因 20 秒传播窗口不足而失败，未把 workflow 总体 conclusion 当作部署状态。
- [x] 记录 run URL、head SHA、Cloudflare deployment 时间和 Version ID。

### 1.3 发布后公开验收

- [x] 用不含 Key、无 body 的 OPTIONS/HEAD 探测验证两个允许 Origin。
- [x] 确认两个 Origin 均为 OPTIONS `204`、允许 Bearer preflight、`no-store`、`Vary: Origin`。
- [x] 确认 decoy 模式无 Key HEAD `200`，且不再出现旧 public cache header。
- [x] 公开契约在部署后前 20 秒短暂返回 `403`，约 55 秒后稳定为新契约；记录证据并把未来 checker 传播窗口扩大至有限 60 秒，未回滚或二次部署。
- [x] 用户于 2026-07-27 确认本地候选 Key验证、保存后的普通下载、完整性校验与缓存均成功；未向 AI 提供 Key。

### 1.4 次级分流

- [x] 不适用：本地验证未出现 HTTP `403`，无需核对 mode/KV binding/entry。
- [x] 不适用：本地验证未出现 byteLength/SHA-256 错误，无需继续核对 R2 metadata。
- [x] 不适用：本地验证未继续出现 `Failed to fetch`，无需收集现场 CORS/DNS/TLS 信息。

## Stage 1.5：修复 CodeQL Worker URL sink

目标文件：

- `apps/userscript/src/inference/inference-types.ts`
- `apps/userscript/src/inference/onnx-worker-client.ts`
- `apps/userscript/src/inference/onnx-worker-entry.ts`
- 对应 worker/client/build 测试

- [x] 从 init 消息契约删除 `ortScriptUrl`。
- [x] Worker 入口从 canonical `onnxRuntimeConfig.ortScriptUrl` 读取固定远程 runtime URL。
- [x] bundled runtime 存在时不调用 `importScripts`；远程模式只调用 canonical URL。
- [x] 覆盖 remote/bundled、加载失败和消息 shape 回归；构建产物不再把消息字段流入 URL sink。
- [x] 默认分支 CodeQL run `30237688682` 成功完成，alert #1 状态为 `fixed`。

验证：

```bash
corepack pnpm --filter @hv-pony-solver/userscript test
corepack pnpm --filter @hv-pony-solver/userscript typecheck
```

## Stage 2：先补部署契约检查器测试

目标文件：

- `apps/model-worker/scripts/check-deployment-contract.test.mjs`

- [x] 建立可注入 `fetchImpl` 与 `sleep` 的测试 harness。
- [x] 覆盖 `decoy` 模式、两个 Origin、OPTIONS `204` + HEAD `200` 成功路径。
- [x] 覆盖 `error` 模式 HEAD `403` 成功路径。
- [x] 用线上已观察到的旧响应 fixture 覆盖 OPTIONS `405`、`Allow: GET, HEAD`、缺失 Authorization CORS header。
- [x] 覆盖错误 allow-origin、allow-methods、cache-control 和 vary。
- [x] 覆盖网络异常、无响应请求超时、重试后成功、重试耗尽。
- [x] 断言探测只使用 OPTIONS/HEAD，不设置 Authorization，不读取 response body。
- [x] 覆盖 probe ID URL 编码与原 query 参数保留。

验证：

```bash
node --test apps/model-worker/scripts/check-deployment-contract.test.mjs
```

预期：实现前测试失败或模块缺失；实现后全部通过。

## Stage 3：实现无秘密 post-deploy checker

目标文件：

- `apps/model-worker/scripts/check-deployment-contract.mjs`
- `apps/model-worker/package.json`

- [x] 实现 header token 解析与精确/包含校验，不引入依赖。
- [x] 实现单轮双 Origin OPTIONS/HEAD 检查。
- [x] 根据 `invalidKeyMode` 校验无 Key HEAD 的 `200`/`403`。
- [x] 实现单请求超时、有限重试和注入式 sleep；最终错误保留 method、Origin、status/header 差异和尝试次数。
- [x] CLI 读取 `MODEL_WORKER_URL`、`MODEL_WORKER_INVALID_KEY_MODE`、`MODEL_WORKER_PROBE_ID`，校验缺失/非法配置。
- [x] CLI 成功/失败使用清晰退出码；不得输出 body、Key 或 credential。
- [x] 在 model-worker package 中新增 `check:deployment` script。
- [x] 把新 node:test 文件纳入现有 package `test` 命令。

局部验证：

```bash
corepack pnpm --filter @hv-pony-solver/model-worker test
corepack pnpm --filter @hv-pony-solver/model-worker typecheck
```

## Stage 4：接入 GitHub 部署 workflow

目标文件：

- `.github/workflows/deploy-cloudflare-model-worker.yml`

- [x] 在 `Deploy Worker` 之后增加 `Verify deployed Worker contract`。
- [x] 使用与 Deploy 完全相同的 `if` 条件，确保仅实际发布后运行。
- [x] 传入 canonical model URL、workflow `invalid_key_mode` 和 GitHub run/attempt probe ID。
- [x] 不向检查步骤传入 Cloudflare credential、KV ID、bucket 或模型 Key。
- [x] checker 失败必须使 deploy job 失败，不使用 `continue-on-error`。
- [x] 保留 dry-run 行为；明确 dry-run 与 post-deploy check 的职责不同。

格式验证：

```bash
corepack pnpm exec prettier --check .github/workflows/deploy-cloudflare-model-worker.yml
```

## Stage 5：更新运维文档

目标文件：

- `README.md`
- `docs/model-worker-ops.md`

- [x] README 命令参考增加 `check:deployment`。
- [x] CI/CD 部署说明增加发布后 contract check，并明确 workflow 绿色但 Deploy skipped 不代表已发布。
- [x] 运维文档记录部署 → public contract → 用户 Key → KV/R2/manifest 的分层验证顺序。
- [x] 记录 post-deploy check 失败后的人工回滚边界；不建议自动回滚。
- [x] 文档不得包含真实 Key、namespace ID、bucket secret 或 deployment credential。

验证：

```bash
corepack pnpm docs:check
```

## Stage 6：质量验证

### 6.1 聚焦检查

```bash
node --test apps/model-worker/scripts/check-deployment-contract.test.mjs
corepack pnpm --filter @hv-pony-solver/model-worker test
corepack pnpm --filter @hv-pony-solver/model-worker typecheck
corepack pnpm docs:check
```

### 6.2 全量检查

```bash
corepack pnpm check
```

- [x] 所有新增测试通过（checker 17 项；Model Worker Vitest 47 项与 node:test 47 项）。
- [x] 原 Model Worker Bearer/KV/R2/CORS 测试保持通过。
- [x] docs drift、architecture、browser sink、coverage 和 build 保持通过。
- [x] 确认测试没有公网请求；公网只在显式 `check:deployment` 或 workflow 发布后步骤中访问。

## Stage 7：质量审查与收尾

- [x] 独立质量审查检查 PRD/设计符合性、安全边界、测试完整性和 workflow 条件；发现 stalled fetch 超时缺口后已修复并复核关闭。
- [x] 检查 git diff，确认没有真实 Key、生成的 `wrangler.toml`、模型文件或 credential；唯一 64 位十六进制值为公开 canonical 模型 SHA-256。
- [x] 更新任务/研究记录，写明根因、恢复 run、公开验收结果、Cloudflare Version ID 和剩余 KV/R2 证据。
- [x] 可复用的部署漂移、Bearer/CORS/KV/R2、checker 与人工回滚规则已写入 `.trellis/spec/model-worker/backend/` 和 Userscript/Shared 对应规范。
- [x] 用户已授权本轮无需 PR直接推送；实现、恢复证据、Trellis 规范和最终验证均已同步到远程 `main`。

## Rollback Points

### RP1：生产部署后公开契约失败

- 不自动二次部署或自动回滚。
- 记录 workflow/deployment 标识和公开响应。
- 向用户说明已发生的生产变更，取得确认后再使用 Cloudflare deployment history 回滚或重新部署已知版本。

### RP2：公开契约通过但 Key 仍失败

- 不回滚正确的 CORS/OPTIONS 部署。
- 按 HTTP 403、decoy/real ETag、R2 size/SHA 分层定位 KV/R2 数据问题。
- 不关闭客户端完整性校验。

### RP3：checker 误报

- 保留 Worker runtime，不因 checker 误报回滚到旧服务。
- 用保存的真实公开 headers 修正 checker/test fixture。
- 必要时暂时回滚 workflow checker step，但仍保留人工 OPTIONS/HEAD 验收。
