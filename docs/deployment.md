# Deployment

本文档定义 userscript 与 model-worker 的发布流程与检查清单。

## 全局前置

```bash
corepack enable
corepack pnpm install
corepack pnpm check
```

> `corepack pnpm check` 会串行执行 lint / typecheck / test / test:coverage / docs:check / build。

---

## Userscript Release Checklist

### 1) 构建与验证

- [ ] 运行 `corepack pnpm check`
- [ ] 运行 `corepack pnpm docs:check`（若只需快速确认 README/docs/source drift）
- [ ] 运行 `pnpm --filter @hv-pony-solver/userscript typecheck`
- [ ] 运行 `pnpm --filter @hv-pony-solver/userscript test`
- [ ] 运行 userscript 构建：

```bash
corepack pnpm --filter @hv-pony-solver/userscript build
```

### 2) 产物检查

- [ ] 产物路径为 `apps/userscript/dist/hv-pony-solver.user.js`
- [ ] userscript metadata 与目标版本一致
- [ ] 若启用压缩构建，确认 minify 参数与预期一致

### 3) 模型配置一致性

- [ ] `packages/shared` 中的 `MODEL_VERSION` 与当前模型发布版本一致
- [ ] `MODEL_INTEGRITY.byteLength` 与 `MODEL_INTEGRITY.sha256` 与发布模型一致
- [ ] 明确 access key 为客户端可见配置，不作为服务端密钥

---

## Model-Worker Release Checklist

### 1) 渲染部署配置（render-config）

必须先渲染本地 `wrangler.toml`：

```bash
MODEL_KEYS_KV_NAMESPACE_ID=<kv-id> MODEL_BUCKET_NAME=<bucket-name> pnpm --filter @hv-pony-solver/model-worker render-config
```

检查项：

- [ ] `PUBLIC_MODEL_PATH` 与预期公开路径一致
- [ ] `REAL_MODEL_OBJECT_KEY` 与 `DECOY_MODEL_OBJECT_KEY` 均已配置
- [ ] `INVALID_KEY_MODE` 与发布策略一致（`decoy` / `error`）

### 2) 类型检查与测试

```bash
pnpm --filter @hv-pony-solver/model-worker typecheck
pnpm --filter @hv-pony-solver/model-worker test
```

检查项：

- [ ] typecheck 通过
- [ ] test 通过
- [ ] GET/HEAD、key 校验、KV 授权、decoy/error 分支测试通过
- [ ] CORS 行为符合目标策略
- [ ] 若新增 HentaiVerse 来源域名，同步更新 Worker CORS 允许源并补充测试

### 3) 模型制品核对（必做）

部署前核对真实模型与配置一致性：

- [ ] `packages/shared` 中的 `MODEL_VERSION`
- [ ] `MODEL_INTEGRITY.byteLength`
- [ ] `MODEL_INTEGRITY.sha256`
- [ ] 对待发布的真实 ONNX 文件运行 manifest 校验：

```bash
MODEL_FILE=/path/to/yolo26n-640.onnx corepack pnpm --filter @hv-pony-solver/userscript verify-model-integrity
```

该命令只读取本地 `MODEL_FILE`，计算 byteLength 与 SHA-256，并与 `packages/shared/src/model.ts` 中的 `MODEL_INTEGRITY` 对比；不连接 R2，也不需要真实凭证。

建议将上述 4 项与 Worker/R2 实际模型及发布记录一起复核，避免“shared manifest 与 Worker/R2 实际模型不一致”。

### 4) 部署

```bash
pnpm --filter @hv-pony-solver/model-worker run deploy
```

> 在 pnpm 10 下，建议显式使用 `run deploy` 以避免与 pnpm 内置命令同名冲突。
