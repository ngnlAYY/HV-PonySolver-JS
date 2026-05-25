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
- 默认启用完整性验证，下载模型与缓存模型都应执行一致校验流程。

## Model download and memory note

The current model is about 9.8 MB. The downloader reads streamed chunks and combines them into one `ArrayBuffer`; this is acceptable for the current model size. If future models grow significantly, update the downloader to preallocate from `Content-Length` and write chunks directly into a single `Uint8Array` to reduce peak memory.

## 构建

```bash
corepack pnpm --filter @hv-pony-solver/userscript build
```

可选压缩构建：

```bash
corepack pnpm --filter @hv-pony-solver/userscript build -- --minify
```

## 发布前最小自检

```bash
corepack pnpm check
pnpm --filter @hv-pony-solver/userscript typecheck
pnpm --filter @hv-pony-solver/userscript test
```
