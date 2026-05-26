# HV Pony Solver 优化计划 2026-05-26

> 来源：基于 `056241b` 上的全量源码分析。共 15 项可优化点，按风险/优先级分组为 5 个执行波次。
> 计划仅记录决策与边界；每个波次的具体改动以子代理 PR 输出与最终 diff 为准。

## 1. 总体目标

在不改变现有 userscript / model-worker 对外行为的前提下，依次完成：

1. 修复影响用户体验或文档一致性的小问题（Wave 1）。
2. 收敛 UI/网络/资源生命周期的健壮性缺口（Wave 2）。
3. 拆解超长函数与重复抽象，降低维护成本（Wave 3）。
4. 简化重复参数、配置聚合、缓冲分配（Wave 4）。
5. 补全边界配置与测试覆盖（Wave 5）。

## 2. 验收命令

每个波次完成后必须跑以下命令并报告结果：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

允许在 worker 测试前临时渲染 wrangler 配置：

```bash
MODEL_KEYS_KV_NAMESPACE_ID=test-kv MODEL_BUCKET_NAME=test-bucket \
  pnpm --filter @hv-pony-solver/model-worker render-config
```

## 3. 不在范围

- 升级 `onnxruntime-web` 主版本
- 改动 R2/KV 数据结构
- 修改 userscript metadata（`@version` 等）
- 新增第三方依赖
- 公开 contract（`packages/shared`）破坏式变更

## 4. 波次详表

### Wave 1 — 文档与 UI 闪烁修复（低风险，可并行）

| 任务 | 描述 | scope_write |
| --- | --- | --- |
| W1-A 面板位置同步加载 | 取消 `StatusPanel.create` 中 `getPanelPosition().then(...)` fire-and-forget。同步读 `localStorage` 直接使用；仅当走 `GM_getValue` 异步路径时延迟到 await 之后再 `appendChild`，消除位置闪烁。 | `apps/userscript/src/status-panel/status-panel.ts`、`apps/userscript/src/status-panel/panel-settings.ts`、相关测试 |
| W1-B README 与代码一致性 | `modelConfig.verifyIntegrity = true`（代码事实）但 README 第 ~445 行声称"默认关闭"。以代码为准，更新 README。 | `README.md` |

> 并行准入：W1-A 与 W1-B 文件集不重叠，可并行。

### Wave 2 — 健壮性（部分串行）

| 任务 | 描述 | scope_write |
| --- | --- | --- |
| W2-A MutationObserver 节流 | `App.observe` 当前对任意子树变更触发；改为只在 100ms 节流窗口内重新调度一次，且通过 `MutationRecord` 过滤掉与 `#riddlemaster` 子树无关的事件。 | `apps/userscript/src/app/app.ts`、`apps/userscript/test/app/app.test.ts` |
| W2-B 图片加载回退 | `CachedImageLoader.get` 在 `only-if-cached` 失败时回退到常规 fetch（`credentials: 'include'`、`mode: 'same-origin'`）。失败原因写入日志。 | `apps/userscript/src/captcha/captcha-image-loader.ts`、新增 `apps/userscript/test/captcha/captcha-image-loader.test.ts` |
| W2-C 提交流程支持中断 | `AnswerSubmitter.submit` 接受 `AbortSignal`；`CaptchaSolver` 与 `App.destroy()` 串联传播。已销毁后回调不再触发 `panel.add*`。 | `apps/userscript/src/captcha/answer-submitter.ts`、`apps/userscript/src/captcha/captcha-solver.ts`、`apps/userscript/src/app/app.ts`、对应测试 |

> 并行准入：W2-A 与 W2-C 都改 `app.ts`，必须串行；W2-B 文件独立，可与其中之一并行。

### Wave 3 — 重构（必须串行，因 app.ts/onnx-worker-client.ts 单点）

| 任务 | 描述 | scope_write |
| --- | --- | --- |
| W3-A 拆 `createWorker` | 拆为 `loadModelBuffer`、`spawnWorker`、`initSession` 三个私有方法；统一 `checkAbort()`。模型 cache 写回改为后台 `Promise`，缩短 prepare 关键路径，但不能并发触发同一 IDB 事务竞争。 | `apps/userscript/src/inference/onnx-worker-client.ts` |
| W3-B `scheduleSolve` 改 async/await | 用 `async + try/finally` 统一管理 `scheduledScan`；语义保持。 | `apps/userscript/src/app/app.ts` |
| W3-C GM bridge 抽取 | 新文件 `apps/userscript/src/userscript/gm-bridge.ts` 集中 `getValue/setValue/deleteValue/registerMenuCommand/alert/prompt/storage` 适配；`model-settings.ts`、`panel-settings.ts` 改用。`logger.ts` 与 `answer-history-store.ts` 通过 `safeStorage` 防止隐私模式抛栈。 | `apps/userscript/src/userscript/gm-bridge.ts`（新）、`apps/userscript/src/model/model-settings.ts`、`apps/userscript/src/status-panel/panel-settings.ts`、`apps/userscript/src/utils/logger.ts`、`apps/userscript/src/persistence/answer-history-store.ts`、相关测试 |

### Wave 4 — 简化与清理（可并行）

| 任务 | 描述 | scope_write |
| --- | --- | --- |
| W4-A 简化 ModelCache 参数链 | 移除 `createCachedModelRow / readCachedModelBuffer / putCached / download` 中重复的 `(integrity, verifyIntegrity)` 透传；保留单一 `force?: boolean` 给 `verifyConfiguredModelKey` 使用。 | `apps/userscript/src/model/model-cache.ts`、`apps/userscript/src/model/model-downloader.ts`、相关测试 |
| W4-B yolo parser top-k 简化 | 用 `push + sort + slice` 替换 `findIndex + splice`，保持输出一致。 | `apps/userscript/src/inference/yolo-output-parser.ts` |
| W4-C 配置聚合 | 新 `apps/userscript/src/config/index.ts` barrel，重新导出 `inferenceConfig`、`solverConfig`、`timingConfig`、`modelConfig`；不删除原文件。 | `apps/userscript/src/config/index.ts`（新） |
| W4-D 下载缓冲一次性分配 | 当响应 `Content-Length` 与 `integrity.byteLength` 一致且开启 verify 时，直接分配 `Uint8Array(byteLength)`，省一次复制。否则回退到当前实现。 | `apps/userscript/src/model/model-downloader.ts`、测试 |

### Wave 5 — 边界与测试

| 任务 | 描述 | scope_write |
| --- | --- | --- |
| W5-A 初始化与推理超时分离 | `inference-config.ts` 拆为 `workerInitTimeoutMs`（60s）与 `workerDetectTimeoutMs`（30s）；`onnx-worker-client.post` 按消息类型选择。 | `apps/userscript/src/inference/inference-config.ts`、`apps/userscript/src/inference/onnx-worker-client.ts`、测试 |
| W5-B Worker CORS 未识别 origin 测试 | 在 `apps/model-worker/test/index.test.ts` 加用例：传入 `Origin: https://attacker.example`，断言不回写 `access-control-allow-origin`、`Vary` 含 `Origin`。 | `apps/model-worker/test/index.test.ts` |

## 5. 子代理派发策略

- 实现型代理：使用 `claude` 通用代理（model=sonnet）。
- 审查型代理：每个 Wave 结束后用 `typescript-reviewer` 复核（轻量，可省略对于纯文档变更）。
- 严禁子代理跨越自身 `scope_write`；如需扩界必须中止并上报。
- 每个子代理必须自行运行 `pnpm lint + typecheck + 仅相关 test`，并把命令输出粘回。

## 6. 收尾

所有波次完成后由主代理：

1. 跑一次完整 `pnpm check`。
2. 汇总各 wave 的 git diff 摘要。
3. 根据约定式提交格式生成多个原子 commit（每个 wave 至少一个 commit）。
4. 报告残留 TODO / 未做项。
