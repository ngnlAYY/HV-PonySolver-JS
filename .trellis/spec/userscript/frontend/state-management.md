# State Management

## No Global State Library

Userscript 没有 Redux/Zustand/Pinia/context store。State由最接近其 lifecycle/persistence 的 class/module拥有，通过 typed methods/ports组合。

## State Categories / Owners

| State                                               | Owner                                                                       | Lifetime / persistence                         |
| --------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------- |
| Observer、scan flags、last captcha、root abort      | `App`                                                                       | 当前 page/app lifecycle                        |
| Busy/current solve                                  | `CaptchaSolver`                                                             | 一次 solver lifecycle                          |
| Worker、ready、prepare promise、detect queue        | `OnnxWorkerClient`                                                          | detector lifecycle                             |
| Pending Worker requests/timeouts                    | `WorkerRequestBridge`                                                       | 一个 Worker bridge                             |
| ONNX session/canvas                                 | `onnx-worker-entry.ts` Worker global                                        | Worker lifetime                                |
| Panel status/history snapshot/render queue          | `StatusPanel`                                                               | panel lifecycle；history由 store持久化         |
| Answer history/answer mode/panel/timing settings    | `answer-history-store.ts`、`answer-mode-settings.ts`、panel/timing settings | GM bridge-backed persistence                   |
| Model access Key/settings                           | `model-settings.ts` + GM bridge                                             | Userscript storage；只在验证成功后保存候选 Key |
| Model bytes/version/integrity cache                 | `model/model-cache.ts`                                                      | IndexedDB，按 canonical manifest校验           |
| Canonical filename/version/hash/answers/token rules | `@hv-pony-solver/shared`                                                    | Immutable contract，不是 mutable store         |

## Ownership Rules

- Composition root把 concrete owner注入依赖；feature只使用 typed port，不直接读另一个 class的 private state。
- Derived state即时计算：captcha key来自 DOM target，formatted panel HTML来自 status/history/settings，model validity来自 canonical manifest。
- 不复制同一 source of truth到多个 mutable globals。
- Sync fallback + async persisted value模式用于 panel settings，callback必须检查 owner仍存活。

## Model Cache / Settings Safety

- Cache entry只有在 version、byteLength、SHA-256 均匹配时可用；corrupt/stale entry不能进入 ONNX session。
- Download继续使用标准 `fetch` + optional `Authorization: Bearer`；不将 Key放 query。
- Candidate Key通过 `accessKeyOverride` 验证，成功后才持久化；cache write failure不能误判 Key无效。
- Key不写 panel/history/log/fixture/task artifact。
- 不使用 `GM_xmlhttpRequest` 绕过 CORS。

## Worker State

- Main thread与 Worker只通过 discriminated message protocol通信。
- Init message只携带 wasmPath/modelBuffer；不允许 caller指定 runtime script URL。
- `destroy()` / worker failure清理 pending、ready、promise、abort handles；stale Worker callback不能修改新 Worker state。
- Detect queue把 session access串行化。

## History / UI State

- History records使用 typed union（success/manual/random/error）和 per-world partition。
- `answer-mode-settings.ts` 单独拥有 `auto | manual` 持久化边界；配置缺失、非法或读取失败时回退 `auto`，保持升级兼容。
- `CaptchaSolver` 在消费推理结果时读取当前模式：`auto` 才进入 `AnswerSubmitter`，`manual` 只写“待手动提交”历史并把 captcha 标记为 handled，禁止修改 checkbox 或点击 submit。
- Renderer接收 snapshot并保持 pure；DOM controller更新 state后 schedule render。
- History limit/compact/position validation在 settings boundary完成，不让非法 persisted value流入 DOM style/slice。

## Forbidden / Common Mistakes

- 创建 `globalThis` mutable store或跨 feature singleton承载 app state。
- UI直接访问 IndexedDB/GM raw keys，或 inference层 import GM bridge。
- Cache命中后跳过 integrity check，或为 stale model修改 manifest“适配”。
- Candidate Key验证前先保存，导致失败后覆盖已知配置。
- Worker destroyed后保留 pending Promise/timer或复用 detached buffer。
- 把 status/history state和 HTML string在多个 module重复维护。

## Validation

```bash
corepack pnpm --filter @hv-pony-solver/userscript test
corepack pnpm architecture:check
```

State change必须覆盖 persistence valid/invalid/missing、destroy/abort、cache stale/corrupt 和 owner重复 init边界。
