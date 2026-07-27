# Type Safety

## Compiler / Lint Baseline

Userscript继承 `tsconfig.base.json`：`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`isolatedModules`。ESLint 禁 explicit `any`；unused参数只允许 `_` prefix。类型 import/export 使用 `import type` / `export type`（当前规则为 warning，新增代码应遵循）。

## Type Organization

- Cross-app stable contracts从 `@hv-pony-solver/shared` 导入：`AnswerCode`、model manifest、token contract。
- Feature ports/messages放所属 `*-types.ts`：`captcha-types.ts`、`inference-types.ts`、`status-panel-types.ts`、history types。
- Concrete class依赖 interfaces/structural ports，而不是 import不相关 feature implementation。
- 只在单个 implementation使用的 options/helper type留在同文件。

## Readonly / Discriminated Protocols

主线程的 `inference-types.ts` 使用 `Readonly<{ type: ... }>` unions表示 init/detect request与 response/error；Worker entry当前在文件内维护对应的 `InitMessage` / `DetectMessage` 镜像类型。协议变更必须同步两侧与 tests。

当前 runtime validation 是有限的，不能描述成完整 schema validation：

- Worker entry按 `message.type` 分支，但直接使用 init/detect payload fields。
- `WorkerRequestBridge` 校验 numeric requestId，并把 `type: 'error'` 转成 rejection；其他 response由 caller继续判断。
- Detect client检查 response type/result；init path主要依赖内部 Worker与 TypeScript/test contract。

- Init message不含动态 `ortScriptUrl`；canonical URL由 Worker entry import config。
- Optional property在 `exactOptionalPropertyTypes` 下只在值存在时写入，不用 `prop: undefined` 冒充 omission。
- Transferable payload的 ownership显式传给 `postMessage`，需要保留时先 copy。

`Readonly` / `as const` 是 compile-time view，不等同 runtime deep freeze。

## Runtime Validation Boundaries

TypeScript不能替代外部值 validation。当前代码实际执行：

- DOM：`instanceof HTMLImageElement` / `HTMLInputElement` / `Element` 和 null check。
- IndexedDB/GM storage：解析 persisted values并应用 type/range/default checks。
- Worker message：有限的 discriminant/requestId/error/result checks；payload shape主要由受控内部协议和 tests保证。
- Network：HTTP status、Content-Length（如存在）、ArrayBuffer byteLength、SHA-256。
- ONNX output：first key/data存在、typed array/buffer offsets和 parser shape checks。
- Errors：从 `unknown` 使用 `instanceof Error` / `String` / `formatErrorMessage`。

若协议将来接收不受控外部消息，应另行增加 runtime guards；本规范不声称这些 guards当前已经存在。

## Narrow Type Assertions

只在 runtime已知但 lib typing无法表达的边界使用 assertion，例如：

- `self as WorkerGlobal`（独立 Worker entry）；
- DOM `record.target as Node` 前已有 owner/contains语义；
- injected test Worker/GM globals。

Assertion周围必须有 runtime guard或局部不变量；禁止链式 `as unknown as` 出现在产品业务路径。

## Real Examples

- `apps/userscript/src/inference/inference-types.ts`：readonly request/response unions和 detector port。
- `apps/userscript/src/inference/onnx-worker-client.ts`：typed options、nullable lifecycle handles、narrowed Worker responses。
- `apps/userscript/src/status-panel/status-panel-types.ts`：UI status sink ports，避免 inference依赖 DOM class。
- `apps/userscript/src/inference/yolo-output-parser.ts`：`noUncheckedIndexedAccess` 下检查 output/class mapping。

## Forbidden / Common Mistakes

- `any`、wide `string`、non-null assertion或 unsafe cast绕开 contract。
- 修改主线程 protocol却未同步 Worker entry镜像类型与两侧 tests。
- 把 persisted/network data直接断言成目标类型；或误称内部 Worker payload已有完整 runtime schema validation。
- Optional field显式赋 `undefined`，或忽略 array index可能为 undefined。
- 把 DOM/GM/Worker-only type搬进 Shared。
- 允许消息 caller选择 script URL等安全敏感 resource。

## Validation

```bash
corepack pnpm --filter @hv-pony-solver/userscript typecheck
corepack pnpm lint
corepack pnpm --filter @hv-pony-solver/userscript test
```
