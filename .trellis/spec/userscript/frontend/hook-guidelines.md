# Lifecycle / Side-Effect Guidelines

## No Framework Hooks

Userscript 没有 React/Vue hooks。此文件记录实际的副作用与 lifecycle约定：`MutationObserver`、timer/microtask、GM menu、network/IndexedDB、Web Worker request、abort/destroy。不要创建 `use*` hook或引入 React Query/SWR。

## App Lifecycle

`apps/userscript/src/app/app.ts` 是根 lifecycle owner：

- `init()` 创建 `AbortController`、panel、一次性 settings menu、初始 scan 和 observer。
- `destroy()` abort solve、disconnect observer、clear timer/flags、destroy detector、close cache、destroy panel。
- `settingsMenuRegistered` 防止重复 registration。
- Async path 在关键 await 后检查 `destroyed`/abort state。

所有新增 long-lived effect必须有 owner和 teardown；不要依赖页面 unload自动清理。

## Mutation / Scheduling

- Observer只关心 captcha subtree或相关 node；先过滤 mutation，避免全页面变化触发昂贵 solve。
- 100ms timer coalesces observer bursts；`observerTimeoutId` 防止重复 timer。
- `scheduledScan` / `pendingScan` / solver `isBusy` 序列化 solve；busy期间只记一次 pending follow-up。
- `queueMicrotask` 用于把同步 mutation/render burst合并，不用于隐藏未处理 Promise。

真实例子：`App.observe`、`App.scheduleSolve`、`StatusPanel.scheduleRender`。

## Cancellation / Async Ownership

- Network/model download接收 `AbortSignal`；destroy时 abort active preparation/solve。
- `OnnxWorkerClient.prepare()` 复用 in-flight `preparePromise`；failure清除 state以允许重试。
- Inference requests通过 `WorkerRequestBridge` 使用 requestId/pending map/timeout；Worker error/replacement必须 reject pending。
- Detect calls通过 Promise queue串行，避免同一 ONNX session并发竞态。
- Transferable `ArrayBuffer` 后不得继续把原 buffer当可用；需缓存时先 `slice()` copy。
- 缓存写失败是 non-critical side effect：不能否定已经下载/初始化成功的本次 session。

## GM Menu / Storage Effects

- GM API只经 `userscript/gm-bridge.ts` 和 `settings-menu.ts`。
- 候选 Key先通过 override下载验证，成功后才保存；旧 Key不能覆盖候选验证。
- Menu callback只返回用户可理解结果，不打印或回显完整 Key。

## Error Propagation

- Effect owner更新对应 status后 rethrow/format；不要 silently ignore critical download/inference failures。
- 明确允许忽略的 best-effort cache write使用窄 catch并说明“不阻止已初始化 session”。
- `unknown` error通过 `formatErrorMessage` 或 `instanceof Error` narrow，包装时保留 `cause`。

## Forbidden / Common Mistakes

- Observer回调每次 mutation直接 solve，形成 storm。
- 未保存 timer/observer/controller handle，导致无法 teardown。
- Destroy 后 async callback继续 append/write/postMessage。
- 同一 Worker session并发 detect，或 replacement Worker response命中旧 pending request。
- Catch 后既不更新状态也不 rethrow，掩盖 critical failure。
- 将 lifecycle logic包装成不存在的 framework hook。

## Validation

重点测试 init/destroy、重复调用、abort-before/after-await、timeout、stale worker、busy/pending scan、cache-write failure。

```bash
corepack pnpm --filter @hv-pony-solver/userscript test
corepack pnpm test:e2e:userscript
```
