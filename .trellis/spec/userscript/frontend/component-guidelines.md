# DOM Component Guidelines

## Framework Reality

Userscript 没有 React/Vue components。这里的“component”指拥有 DOM/lifecycle 的 class/function：例如 `StatusPanel`、settings menu registration、captcha target/answer submission。

## Controller + Pure Renderer

Status panel 的真实模式：

- `apps/userscript/src/status-panel/status-panel.ts`：stateful controller，负责 `create()` / `destroy()`、history/status state、position 与 render scheduling。
- `apps/userscript/src/status-panel/status-panel-renderer.ts`：pure formatting，输入 world/status/records/settings，返回 HTML string。
- `status-panel-types.ts`：其他 feature只依赖 `StatusPanel` / status sink ports，不依赖具体 DOM class。

新增复杂 UI 优先分离 state/effects 与 pure renderer；不要引入 framework只为一个 panel。

## Lifecycle

- `create()` 必须 idempotent；已有 element 时返回。
- `destroy()` 移除 element/listener/observer/timer并清 state handle，使重复 init/destroy 可预测。
- Async setting读取完成时先确认 element/controller仍存活，再写 DOM。
- 高频变化使用一次 microtask render queue，并在 HTML 未变化时跳过写入，避免重复 DOM churn。

`StatusPanel.scheduleRender` / `lastHtml` 是现有例子；App 总生命周期见 `apps/userscript/src/app/app.ts`。

## HTML / Browser Sink Safety

`innerHTML` 只允许在受审计的 status panel sink；`scripts/check-browser-sinks.mjs` 对每个 allowlisted 文件限制 sink 上限，但不会要求配额全部被使用。所有来自 history/error/world/status 的动态文本先经过 `escapeHtml`（`apps/userscript/src/utils/html.ts`）。

优先：

- `document.createElement`
- `textContent`
- typed property/attribute assignment

只有确实需要固定 markup composition 时才用 audited renderer + escaping。新增 sink 必须说明 trust boundary、补测试并更新 browser-sink guard；不能简单扩大 allowlist。

## DOM Behavior / Accessibility

- 保留站点已有 checkbox/input/button semantics；通过 typed selectors/guards确认 element 类型后操作。
- Settings 使用 GM menu/explicit prompt path，不创建隐藏 credential DOM。
- 用户反馈通过 status/model settings message表达，不在 console输出 Key或敏感状态。
- 动态位置/compact/history settings必须有 sync fallback，异步值随后收敛，避免 panel 首次闪烁或不存在时写入。

## Styling

- Status panel 使用 owned `.ponyLog` element；位置由 panel settings和 inline numeric pixel values更新。
- 不引入 CSS framework、CSS-in-JS 或全局 reset。
- 新 style 必须限制在 userscript-owned class/element，不能污染 Hentaiverse 页面全局元素。

## Forbidden / Common Mistakes

- 把不可信 string直接插入 `innerHTML`。
- 在 renderer 中读 storage、修改 DOM 或触发 async effect。
- `create()` 重复 append element，`destroy()` 不 remove。
- Async callback在 component destroy 后继续写 element。
- 新增 framework component/hook，而当前 vanilla class/function足够。
- 为验证 Key把 Key写进 DOM、URL、log 或 error details。

## Tests / Validation

- Pure renderer：escaping、empty/base/error/history limit/compact branches。
- Controller：create/destroy idempotency、queued render、async settings after destroy。
- E2E：本地 fixture 验证 build artifact启动与关键 DOM行为。

```bash
corepack pnpm --filter @hv-pony-solver/userscript test
corepack pnpm browser-sinks:check
corepack pnpm test:e2e:userscript
```
