# 故障排查

先确认客户端版本、构建模式和首个错误。面板隐藏不等于识别停止；显示条件见[设置说明](settings.md)。问题报告只保留脱敏错误，不复制 Key、Authorization 或受保护资源标识。

## pnpm 版本不匹配

```bash
mise install
mise exec -- node --version
mise exec -- pnpm --version
mise exec -- pnpm install --frozen-lockfile
```

项目固定 pnpm `12.3.0`。使用 `mise exec -- pnpm` 可明确选择仓库版本；若直接执行 `pnpm` 仍命中其他版本，请检查当前 shell 的 mise 激活配置。

## 默认构建无法加载 ONNX Runtime

确认管理器与网络允许访问 `cdn.jsdelivr.net`。默认 profile 不自动回退；大小或 SHA-256 错误应逐项核对 classic JS、JSEP MJS 和 WASM 的固定 URL、无重定向、解压后长度与哈希，依据 [Runtime 清单](../onnx-runtime.md)，不要放宽上限或跳过校验。

需要避开 CDN 时显式构建 `bundled` profile；它仍需访问 `models.ngnl.host` 下载精简 WASM 和 `.ort` 模型。

## 精简 WASM 初始化失败

用户脚本先按 [Runtime 清单](../onnx-runtime.md)核对 R2 对象键与 `PUBLIC_RUNTIME_WASM_PATH`、实际长度、SHA-256、无重定向和 `Content-Type: application/wasm`。

本地先运行：

```bash
mise exec -- pnpm verify:onnx-runtime
```

扩展版还应运行：

```bash
mise exec -- pnpm --filter @hv-pony-solver/extension build
mise exec -- pnpm --filter @hv-pony-solver/extension test:e2e:chromium:load-only
```

扩展不从 R2 下载 WASM；它读取包内 `runtime/ort-wasm-simd-<sha256>.wasm`。若出现 Emscripten import/link 错误，优先确认构建器使用的定制 glue 与包内 WASM 哈希是一对匹配资产。

## 内置模型扩展构建失败

内置版本只接受仓库根目录 `model/yolo26n-640.ort`，清理旧 `dist` 前检查普通文件身份、长度和 SHA-256，拒绝符号链接。它不用 `KvKey` 下载，也无路径覆盖或远程回退。修复文件后运行：

```bash
mise exec -- pnpm --filter @hv-pony-solver/extension build:packaged
```

## 页面显示“答案控件不可用”

答题阶段的控件快照不满足安全点击条件。依次检查：

- 当前表单和提交按钮仍连接在页面中，且 `submit.form` 指向该表单；
- 表单及按钮 `formaction` 的解析后地址仍与识别开始时一致，且为同源；
- 页面存在同一表单下的 6 个答案 checkbox；
- 每个 checkbox 仍连接、类型未变、`checkbox.form` 指向该表单且未被禁用，包括 `fieldset` 继承禁用（首个 `legend` 例外）；
- 没有同时启用用户脚本版和扩展版；
- 网页存档是否缺少页面脚本生成的关联状态；存档能复现 DOM 解析，不保证控件与在线页面同样可用。

这类失败对同一验证码冷却 30 秒，DOM 刷新不会重复记录；提交按钮重新启用可提前恢复。如果日志在毫秒级持续出现，检查实际加载版本、完整构建目录及是否启用了双重实例。

## JPX 开启 AjaxRound 后只答第一题

JPX 的 AJAX 换轮会清除最近 100 个页面定时器。旧扫描逻辑可能保留一个已被清除的定时器句柄，随后一直等待，表现为首题正常、后续不识别，刷新页面后暂时恢复。

当前核心在后续验证码相关 DOM 变化时重挂扫描定时器，保留原截止时间，避免高频变化无限推迟扫描；原生勾选、提交、去重和失败冷却不变。完整更新扩展后，在管理页重新加载并刷新游戏页；只更新磁盘文件不会替换运行中的内容脚本。暂时无法更新时，可关闭 JPX 的 `AjaxRound`，使用完整页面换轮，无需修改 JPX。

该路径有 Chromium 扩展离线 fixture 的连续三题回归，模拟 JPX 的导入页面、原生表单事件与定时器清理；不等同于真实游戏、生产模型或 Firefox 的 JPX 验收。

## 扩展额度查询或模型下载报错

- 先确认远程模型版已保存有效 Key；内置模型版会禁用这些按钮。
- “查询下载次数”不消耗额度；“下载模型”只有在完整校验并提交 IndexedDB 缓存后才确认一次使用。
- `HTTP 429` 表示该 Key 本 UTC 月已确认用完 5 次；`HTTP 503` 还可能表示临时回执槽位占满或额度服务不可用，两者不能混为一谈。
- “连接已断开”表示后台 Port 断连，不等同于额度耗尽。仅额度查询自动重连一次，仍失败时保留真实浏览器错误。
- `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`：检查是否仍运行旧版或混合构建，完整替换构建目录并重新加载，不要只覆盖一个 JS 文件。

## 页面导航时报 `Unchecked runtime.lastError` 与 back/forward cache

Chrome 页面进入前进／后退缓存（BFCache）时可能关闭消息 Port。`The page keeping the extension port is moved into back/forward cache` 指向页面生命周期变化；`Unchecked` 表示断连回调未读取浏览器错误，不代表模型、Key 或额度校验失败。

当前实现同步读取断连原因并取消未决请求，页面恢复后重新初始化、按需连接。完整重新加载扩展后刷新游戏页即可，无需禁用 BFCache。

仍出现时，核对扩展 ID／脚本来源、加载目录及是否正在前进／后退；停留页面也无法识别时，记录具体连接原因、浏览器版本与重现步骤。

## 模型请求返回诱饵内容或 `403`

确认请求使用 `Authorization: Bearer`，token 为 64 位十六进制且未放入查询字符串。运维侧检查 `MODEL_KEYS` 中对应 token 的非空标记和 `INVALID_KEY_MODE`。模型 GET 的 `403` 属于永久 Key 拒绝，不会按瞬时故障自动重试；修复并保存凭证后再恢复当前失败目标。

## 内置构建体积异常

先构建内置 profile，再检查内置预算：

```bash
mise exec -- pnpm --filter @hv-pony-solver/userscript build:bundled-runtime
mise exec -- pnpm bundle:check:bundled
```

不要对默认 profile 产物使用内置预算来判断运行时是否真正被打包。构建产物清单中的 `bundledRuntime` 必须与预期 profile 一致。

## Model Worker 部署命令未执行项目脚本

使用：

```bash
mise exec -- pnpm --filter @hv-pony-solver/model-worker run deploy
```

不要省略 `run`。

## 局部切页后面板消失

核心会把原面板挂回当前 body，保留状态和历史；应用已销毁时不恢复。确认已安装最新构建，并检查 `div#csp` 显示限制与面板坐标；可从设置选择始终显示。

## 提交问题时附带什么

注明客户端版本、remote/packaged 或 external/bundled 模式、浏览器完整版本、发生阶段、脱敏错误文字及最小重现步骤。涉及本地检查时附命令和失败阶段；区分 fixture、load-only、真实模型推理。生成物、浏览器配置和网络导出可能包含秘密，不直接提交到仓库。
