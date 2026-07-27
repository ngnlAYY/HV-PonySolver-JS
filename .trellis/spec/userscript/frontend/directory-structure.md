# Directory Structure

## Actual Layout

```text
apps/userscript/
├── src/
│   ├── main.ts             # thin bootstrap
│   ├── app/                # App lifecycle + composition root
│   ├── captcha/            # target/image/solver/answer submission
│   ├── config/             # exported user-facing config aggregation
│   ├── inference/          # preprocessing、YOLO parser、Worker client/entry/bridge/assets
│   ├── model/              # config、Bearer download、integrity、cache facade、settings
│   ├── persistence/        # answer history storage/types/config
│   ├── status-panel/       # DOM controller、pure renderer、settings、ports
│   ├── userscript/         # GM bridge、metadata、menu registration
│   └── utils/              # small cross-feature helpers
├── test/                   # mirrors feature areas + helpers/fixtures
│   └── e2e/               # Playwright local fixture smoke
├── scripts/                # build/assets/model verification/benchmark
├── dist/                   # generated artifact; ignored
├── package.json
├── tsconfig.json
├── playwright.config.ts
└── vitest.config.ts
```

## Module Ownership

- `main.ts` 只 bootstrap `App`，不堆 feature logic。
- `app/app-dependencies.ts` 是 composition root：实例化 history、panel、model cache、detector、solver；feature modules通过 typed ports连接。
- DOM captcha parsing/submission 留在 `captcha/`。
- ONNX/Web Worker 专属逻辑留在 `inference/`；pure preprocess/parser 与 lifecycle client/entry分开。
- Download/Bearer/integrity/cache settings 留在 `model/`；IndexedDB/GM boundaries不要散到 UI。
- `status-panel/` 将 stateful `StatusPanel` 与 pure `renderStatusPanel` 分开。
- GM API只经 `userscript/gm-bridge.ts` 和 menu/metadata adapter暴露。
- 只有确实跨 feature、无领域 owner 的小函数放 `utils/`。

## Worker / Build Boundaries

`onnx-worker-entry.ts` 是独立 Worker build entry，不是主页面 module。`onnx-worker-script.ts` / `blob-worker.ts` 负责把 audited source组成 Blob Worker。主线程 public request/response types位于 `inference-types.ts`；Worker entry当前维护对应的局部镜像类型，协议变更必须同步两侧与 tests，不能假定存在单一 runtime schema。

Remote runtime URL 由 Worker entry import 的 canonical `inference-config` 决定，不能从 caller message注入。Bundled runtime通过 build-time source路径处理。

## Naming / Imports

- 文件/目录使用 lower-kebab-case；class/type/function 使用 TypeScript 常规 PascalCase/camelCase。
- Ports/interfaces 放在所属 feature 的 `*-types.ts`；跨 app stable contract从 `@hv-pony-solver/shared` 导入。
- 类型 import 使用 `import type`（当前 lint 为 warning，但新增代码应遵循）。
- Tests 按 feature镜像，script tests使用 `node:test`，browser behavior使用 Vitest/jsdom 或 Playwright fixture。

## Real Examples

- `apps/userscript/src/app/app.ts` 的 `App` 只协调 lifecycle/scan/solve，依赖由 `app-dependencies.ts` 组合。
- `apps/userscript/src/inference/onnx-worker-client.ts` 管理 Worker lifecycle，`worker-request-bridge.ts` 管理 request IDs/timeouts/pending map，`onnx-worker-entry.ts` 管理 Worker global/session。
- `apps/userscript/src/status-panel/status-panel.ts` 持有 DOM/state，`status-panel-renderer.ts` 是 pure HTML formatter。
- `apps/userscript/src/model/model-downloader.ts` 与 `model-integrity.ts` 分离 network 和 cryptographic validation。

## Forbidden / Common Mistakes

- 把所有 behavior 放回 `main.ts` 或创建 generic `helpers.ts` dumping ground。
- Feature 相互直接读取内部 mutable state，而不是 typed port/explicit method。
- Inference layer import status panel implementation或 GM storage bridge；architecture guard会拒绝部分边界。
- 主线程和 Worker 复制不一致 message shape。
- 编辑 `dist/` 或把 build/coverage/.tmp产物提交。
- 把单 app internal code移入 Shared 只为减少相对 import。

## Validation

```bash
corepack pnpm --filter @hv-pony-solver/userscript typecheck
corepack pnpm architecture:check
corepack pnpm --filter @hv-pony-solver/userscript test
```
