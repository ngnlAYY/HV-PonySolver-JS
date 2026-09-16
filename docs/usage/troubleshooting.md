# 故障排查

先确认安装的客户端、构建模式及最先出现的错误。状态面板不可见与识别未运行是两回事；显示条件与历史规则见[设置说明](settings.md)。错误记录只保留版本、阶段和脱敏的 HTTP 状态，不复制 Key、Authorization 或受保护资源标识。

## pnpm 版本不匹配

```bash
mise install
mise exec -- node --version
mise exec -- pnpm --version
mise exec -- pnpm install --frozen-lockfile
```

项目固定 pnpm `12.3.0`。使用 `mise exec -- pnpm` 可明确选择仓库版本；若直接执行 `pnpm` 仍命中其他版本，请检查当前 shell 的 mise 激活配置。

## 默认构建无法加载 ONNX Runtime

确认用户脚本管理器和网络允许访问：

```text
cdn.jsdelivr.net
```

默认 profile 没有内置回退。若错误提示运行时大小或 SHA-256 校验失败，应先确认三个固定资产 URL 都未重定向：classic JS 实际解压字节匹配 `externalFullRuntime.byteLength` 与 `externalFullRuntime.sha256`，JSEP MJS 匹配 `externalFullRuntime.mjsByteLength` 与 `externalFullRuntime.mjsSha256`，WASM 匹配 `externalFullRuntime.wasmByteLength` 与 `externalFullRuntime.wasmSha256`；不要放宽对应 `maxByteLength`、`mjsMaxByteLength` 或 `wasmMaxByteLength` 上限，也不要跳过校验。需要绕过完整版 CDN 时，应改用显式内置构建；内置构建仍需要访问 `models.ngnl.host` 下载精简 WASM 和 `.ort` 模型。

## 精简 WASM 初始化失败

检查以下项目：

- R2 对象键与 `PUBLIC_RUNTIME_WASM_PATH` 是否匹配。
- 响应是否发生重定向。
- 字节长度是否为 `1,267,937`。
- SHA-256 是否为 `25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa`。
- `Content-Type` 是否为 `application/wasm`。

本地先运行：

```bash
pnpm verify:onnx-runtime
```

扩展版还应运行：

```bash
pnpm --filter @hv-pony-solver/extension build
pnpm --filter @hv-pony-solver/extension test:e2e:chromium:load-only
```

扩展不从 R2 下载 WASM；它读取包内 `runtime/ort-wasm-simd-<sha256>.wasm`。若出现 Emscripten import/link 错误，优先确认构建器使用的定制 glue 与包内 WASM 哈希是一对匹配资产。

## 内置模型扩展构建失败

内置版本只接受仓库根目录的固定输入：

```text
model/yolo26n-640.ort
```

构建会在清理旧 `dist` 前拒绝缺失文件、符号链接、非普通文件、错误长度或错误 SHA-256。它不会使用 `KvKey` 下载模型，也没有路径覆盖或远程回退。修复模型文件后运行：

```bash
pnpm --filter @hv-pony-solver/extension build:packaged
```

## 页面显示“答案控件不可用”

这表示识别已到达答题阶段，但保存的表单控件快照不满足安全点击条件。依次检查：

- 当前表单和提交按钮仍连接在页面中，且 `submit.form` 指向该表单；
- 表单的解析后提交地址仍与识别开始时一致，并且是同源地址；
- 页面存在同一表单下的 6 个答案 checkbox；
- 每个 checkbox 仍连接、`checkbox.form` 指向同一表单且没有 `disabled`；
- 没有同时启用用户脚本版和扩展版；
- 离线保存的 HTML 是否缺少原页面脚本生成的关联状态。网页存档可以用于复现 DOM 解析，但不保证表单控件与在线页面具有相同可用状态。

当前版本对同一验证码失败冷却 30 秒；冷却期内的 MutationObserver 刷新不会新增同类记录。如果日志在毫秒级持续出现，先确认浏览器实际加载的是扩展 `0.1.1` 的完整新构建，而不是旧 ZIP、旧解压目录或用户脚本与扩展的双重实例。

## 扩展额度查询或模型下载报错

- 先确认远程模型版已保存有效 Key；内置模型版会禁用这些按钮。
- “查询下载次数”不消耗额度；“下载模型”只有在完整校验并提交 IndexedDB 缓存后才确认一次使用。
- `HTTP 429` 表示该 Key 本 UTC 月已确认用完 5 次；`HTTP 503` 还可能表示临时回执槽位占满或额度服务不可用，两者不能混为一谈。
- “连接已断开”是扩展后台 Port 未返回结果，不等同于 Worker 返回额度耗尽。额度查询会自动重连一次，仍失败时保留第二次的真实浏览器错误。
- `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation` 通常表示仍在运行旧版或混合构建文件；重新构建并完整替换解压目录后重新加载扩展，不要只覆盖单个 JavaScript 文件。

## 模型请求返回诱饵内容或 `403`

确认：

- 请求使用 `Authorization: Bearer`。
- token 是 64 位十六进制字符串。
- `MODEL_KEYS` 中存在对应 token 的非空标记。
- 没有把 token 放在查询字符串中。
- `INVALID_KEY_MODE` 与预期一致。

## 内置构建体积异常

先构建内置 profile，再检查内置预算：

```bash
pnpm --filter @hv-pony-solver/userscript build:bundled-runtime
pnpm bundle:check:bundled
```

不要对默认 profile 产物使用内置预算来判断运行时是否真正被打包。构建产物清单中的 `bundledRuntime` 必须与预期 profile 一致。

## Model Worker 部署命令未执行项目脚本

使用：

```bash
pnpm --filter @hv-pony-solver/model-worker run deploy
```

不要省略 `run`。

## 局部切页后面板消失

当前核心会把原面板挂回新的 body，保留状态和历史。如果页面没有 `div#csp`，默认设置仍会隐藏面板；可从设置入口选择始终显示，并核对面板坐标是否落在可视区域。应用已销毁时不会恢复挂载。浏览器实际加载的构建也必须包含该修复；源码已修改不代表已安装客户端已经更新。

## 提交问题时附带什么

注明客户端版本、remote/packaged 或 external/bundled 模式、浏览器完整版本、发生阶段、脱敏错误文字及最小重现步骤。涉及本地检查时附命令和失败阶段；区分 fixture、load-only、真实模型推理。生成物、浏览器配置和网络导出可能包含秘密，不直接提交到仓库。
