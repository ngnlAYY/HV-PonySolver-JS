# Userscript

`apps/userscript` 构建并输出浏览器 userscript：

```text
apps/userscript/dist/hv-pony-solver.user.js
```

## 本地存储键（必须项）

userscript 当前涉及以下本地键：

| Key                          | 用途                                                    |
| ---------------------------- | ------------------------------------------------------- |
| `hvPonySolverModelAccessKey` | 存储模型下载访问 key（优先 GM 存储，回退 localStorage） |
| `hvPonySolverPanelPosition`  | 状态面板位置持久化（用于恢复面板布局）                  |
| `local_answer_history_v2`    | 最近答题记录（主世界/异世界）                           |
| `hvPonySolverDebug`          | 调试日志开关（`1` 时输出调试日志）                      |

## Local data classification

| Key                          | Storage                           | Sensitivity               | Notes                                                                      |
| ---------------------------- | --------------------------------- | ------------------------- | -------------------------------------------------------------------------- |
| `hvPonySolverModelAccessKey` | GM storage, localStorage fallback | User-visible access token | Not a server-side secret; rotate if shared accidentally.                   |
| `hvPonySolverPanelPosition`  | GM storage, localStorage fallback | Low                       | UI preference only.                                                        |
| `local_answer_history_v2`    | localStorage                      | Medium                    | Reveals recent answer activity; can be cleared by browser storage cleanup. |
| `hvPonySolverDebug`          | localStorage                      | Low                       | Enables debug logging.                                                     |

Prefer GM storage for userscript settings when available. localStorage fallback exists for compatibility and should not be treated as confidential storage.

## Access Key 安全定位

`hvPonySolverModelAccessKey` 是客户端可见配置，不是服务端保密密钥。

- userscript 安装者可读取构建产物或本地存储内容。
- 因此 access key 只能作为“访问分流信号”，不能承担服务端强保密职责。
- 真正的授权判断在 Worker 侧通过 KV 完成。

## 模型下载与缓存完整性

模型缓存位于浏览器 IndexedDB（`pony-solver-local`）。

建议与目标策略：

- 模型缓存应绑定 `packages/shared` 中的 `MODEL_VERSION`。
- 模型完整性应使用 `packages/shared` 中的 `MODEL_INTEGRITY.byteLength` + `MODEL_INTEGRITY.sha256` 双重校验。
- 远端模型更新时，应同步更新 shared manifest 中的 `MODEL_VERSION / MODEL_INTEGRITY`。
- 发布前对待发布 ONNX 文件运行 `MODEL_FILE=/path/to/yolo26n-640.onnx corepack pnpm --filter @hv-pony-solver/userscript verify-model-integrity`，确认本地模型 byteLength 与 SHA-256 和 shared manifest 一致。
- 默认启用完整性验证，下载模型与缓存模型都应执行一致校验流程。

## Model download and memory note

The current model is about 9.8 MB. The downloader reads streamed chunks and combines them into one `ArrayBuffer`; this is acceptable for the current model size. If future models grow significantly, update the downloader to preallocate from `Content-Length` and write chunks directly into a single `Uint8Array` to reduce peak memory.

## YOLO 输出解析

YOLO 输出格式假设集中在 `inferenceConfig.yoloOutputConfig`，当前按每行 6 个 float 读取：第 5 个值是 confidence，第 6 个值是 class id。解析时忽略尾部不完整行、非有限 confidence 和无法映射到答案的 class id；浮点 class id 会先按 `Math.trunc()` 截断。没有任何行达到阈值时，会回退到最高 confidence 的有效行。重复 class 只保留最高 confidence，并返回所有去重后的命中答案；超过 `maxKinds` 时结果为不成功，但不会丢弃超出部分的命中信息。

## 调试日志

userscript 菜单提供 `开启调试日志` 与 `关闭调试日志`。开启后，脚本会在浏览器 console 输出带 `[PonySolverLocal]` 前缀的调试日志。默认关闭，不会输出普通调试日志；警告和错误仍会输出，便于排障。

调试开关存储在 `hvPonySolverDebug`，优先使用 GM storage，回退到 localStorage。不要在调试日志、截图或支持消息中粘贴完整模型 access key 或带 `?key=` 的模型 URL。

## 构建

```bash
corepack pnpm --filter @hv-pony-solver/userscript build
```

构建脚本的测试会检查 bundle budget：main bundle 目标小于 80KB，worker bundle 目标小于 20KB。

## 可选浏览器 smoke

`apps/userscript` 另有独立 Playwright smoke，用真实 Chromium 加载本地 mock 页面、mock captcha 图片与 mock detector，验证状态面板创建、captcha DOM 识别、checkbox 点击和提交事件链路。该测试不会访问真实 Hentaiverse，也不使用真实 access key；未并入 root `check` 脚本，避免常规检查依赖浏览器安装。

```bash
corepack pnpm --filter @hv-pony-solver/userscript test:e2e
```

首次运行或 Playwright 版本更新后，如提示缺少浏览器，请运行：

```bash
corepack pnpm --filter @hv-pony-solver/userscript exec playwright install chromium
```

可选压缩构建：

```bash
corepack pnpm --filter @hv-pony-solver/userscript build -- --minify
```

## 发布前最小自检

```bash
corepack pnpm check
corepack pnpm docs:check
pnpm --filter @hv-pony-solver/userscript typecheck
pnpm --filter @hv-pony-solver/userscript test
```

> `corepack pnpm check` 已覆盖 lint / typecheck / test / test:coverage / docs:check / build。
