# 命令参考

所有命令从仓库根目录执行。下文简写 `pnpm` 假定 shell 已激活 mise；未激活时使用 `mise exec -- pnpm`。初次安装、Worker 测试绑定和验证范围见[验证手册](verification.md)。命令是否存在以根和工作区 `package.json` 为准。

## 工具链

| 工具    | 要求                            |
| ------- | ------------------------------- |
| Node.js | `24.15.0`，最低兼容 `>=24.15.0` |
| pnpm    | `12.3.0`                        |

[mise.toml](../../mise.toml) 固定本地与 CI 工具版本。

```bash
mise trust
mise install
mise exec -- pnpm install --frozen-lockfile
```

准备好测试绑定后执行 `mise exec -- pnpm check`。

## 仓库级命令

| 命令                                                        | 作用                                                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm build`                                                | 构建所有工作区包，用户脚本使用默认外部 profile                                                                                                               |
| `pnpm format:check`                                         | 检查第一方源码、配置与文档格式；排除生成物、第三方资产和 pnpm 锁文件                                                                                         |
| `pnpm lint`                                                 | 执行 ESLint                                                                                                                                                  |
| `pnpm typecheck`                                            | 对所有工作区执行 TypeScript 类型检查                                                                                                                         |
| `pnpm test`                                                 | 执行工作区和仓库级测试                                                                                                                                       |
| `pnpm test:coverage`                                        | 生成覆盖率报告                                                                                                                                               |
| `pnpm docs:check`                                           | 检查契约与源码/资产漂移、文档命令、本地链接、标题锚点及决策笔记结构与归档封印                                                                                |
| `pnpm architecture:check`                                   | 检查跨层和跨应用导入边界                                                                                                                                     |
| `pnpm browser-sinks:check`                                  | 检查浏览器危险调用白名单                                                                                                                                     |
| `pnpm bundle:check`                                         | 构建未压缩的默认 profile 并检查 `256 KiB` 预算                                                                                                               |
| `pnpm bundle:check:default`                                 | 检查当前产物的默认 profile 预算                                                                                                                              |
| `pnpm bundle:check:bundled`                                 | 检查当前产物的内置 profile 预算                                                                                                                              |
| `pnpm benchmark:inference`                                  | 执行推理预处理和解析基准，不作为 CI 性能门槛                                                                                                                 |
| `pnpm benchmark:extension`                                  | 执行有界 Chromium CI transport smoke（4 个场景、1,600 次操作、约 201 MiB 负载）；不作为性能比较证据                                                          |
| `pnpm benchmark:extension:full`                             | 显式执行代表性双浏览器矩阵（16 个场景、343,200 次操作、约 335 GiB 负载）；仅用于有意的本地基线/候选比较                                                      |
| `pnpm benchmark:extension:quick`                            | 执行降低采样的 Chromium transport smoke；不能作为性能比较证据                                                                                                |
| `pnpm benchmark:extension:product`                          | 使用本地固定模型测量实际 Chromium 消息与 ORT 推理链路，并在 localhost 回放模型下载、缓存和确认                                                               |
| `pnpm benchmark:extension:exhaustive`                       | 显式执行完整 transport 尺寸矩阵；成本显著高于默认代表性矩阵                                                                                                  |
| `pnpm test:e2e:userscript`                                  | 执行用户脚本 Playwright Chromium 测试                                                                                                                        |
| `pnpm test:e2e:extension:content`                           | 加载临时 Chromium 扩展并执行确定性内容脚本整链 fixture                                                                                                       |
| `pnpm test:e2e:extension:chromium:load-only`                | 加载生产远程 Chromium 产物，仅验证加载与普通设置，不声称已验证远程模型                                                                                       |
| `pnpm test:e2e:extension:chromium:authenticated`            | 从受保护环境读取 `KvKey`，验证真实模型后至少执行一次 `detect`；缺少 Key 时 fail closed                                                                       |
| `pnpm test:e2e:extension:firefox:load-only`                 | 用 Firefox 临时安装生产远程 ZIP，并验证当前设置页控件；不声称已执行鉴权推理                                                                                  |
| `pnpm --filter @hv-pony-solver/extension test:e2e:packaged` | 在真实 Chromium 和 Firefox 中验证内置模型、无 Key 推理及会话重建                                                                                             |
| `pnpm check:userscript`                                     | 执行用户脚本聚合检查                                                                                                                                         |
| `pnpm check:browser-core`                                   | 执行共用浏览器核心的类型、单元和契约检查                                                                                                                     |
| `pnpm check:extension`                                      | 执行扩展类型、测试、双目标构建和 Firefox 严格 lint                                                                                                           |
| `pnpm extension:package-check`                              | 重新生成扩展双目标产物，并执行 Firefox 严格 lint                                                                                                             |
| `pnpm check:model-worker`                                   | 执行 Model Worker 聚合检查                                                                                                                                   |
| `pnpm check:quick`                                          | 依次执行 `format:check`、`lint`、`typecheck`、`test`、`docs:check`、`architecture:check`、`browser-sinks:check`、`extension:package-check` 和 `bundle:check` |
| `pnpm check`                                                | 先执行 `check:quick`，再执行 `test:coverage` 和 `build`                                                                                                      |
| `pnpm build:onnx-runtime`                                   | 从固定上游构建精简 ONNX Runtime                                                                                                                              |
| `pnpm verify:onnx-runtime`                                  | 校验已纳入仓库的精简 glue                                                                                                                                    |

## 用户脚本命令

```bash
pnpm --filter @hv-pony-solver/userscript build
pnpm --filter @hv-pony-solver/userscript build:bundled-runtime
pnpm --filter @hv-pony-solver/userscript test
pnpm --filter @hv-pony-solver/userscript typecheck
pnpm --filter @hv-pony-solver/userscript test:e2e
pnpm --filter @hv-pony-solver/userscript verify:onnx-runtime
```

## 浏览器扩展命令

```bash
pnpm --filter @hv-pony-solver/extension benchmark
pnpm --filter @hv-pony-solver/extension benchmark:ci
pnpm --filter @hv-pony-solver/extension benchmark:full
pnpm --filter @hv-pony-solver/extension benchmark:quick
pnpm --filter @hv-pony-solver/extension benchmark:exhaustive
pnpm --filter @hv-pony-solver/extension benchmark:compare -- BASELINE_JSON CANDIDATE_JSON [OUTPUT_JSON]
pnpm --filter @hv-pony-solver/extension benchmark:product
pnpm --filter @hv-pony-solver/extension typecheck
pnpm --filter @hv-pony-solver/extension test
pnpm --filter @hv-pony-solver/extension test:coverage
pnpm --filter @hv-pony-solver/extension build
pnpm --filter @hv-pony-solver/extension build:packaged
pnpm --filter @hv-pony-solver/extension test:e2e:content
pnpm --filter @hv-pony-solver/extension test:e2e:chromium:load-only
pnpm --filter @hv-pony-solver/extension test:e2e:chromium:authenticated
pnpm --filter @hv-pony-solver/extension test:e2e:firefox:load-only
pnpm --filter @hv-pony-solver/extension test:e2e:packaged:chromium
pnpm --filter @hv-pony-solver/extension test:e2e:packaged:firefox
pnpm --filter @hv-pony-solver/extension test:e2e:packaged
```

`test:e2e:content` 使用只存在于临时测试构建中的确定性推理 Host，不访问真实模型服务。`test:e2e:chromium:load-only` 只证明生产远程版本可加载和设置可持久化；Firefox load-only 还会打开实际 ZIP 的设置页，核对 Key、次数查询、模型下载、面板显示限制和保留手动答案控件，二者都明确不验证远程模型。只有受保护的 `test:e2e:chromium:authenticated` 才读取 `KvKey`；它在鉴权下载和完整性校验后必须至少完成一次真实 `detect`，不能停在 `prepare`，缺少 Key 时直接失败。内置模型门禁不读取 Key 并显式关闭随机回退：Chromium 先校验实际 ZIP 与 artifact，再解压到临时目录并只加载该目录；Firefox 用标准 WebDriver 安装已校验的实际 ZIP（需要 `geckodriver` 与 `openssl`）。两者都断言成功类型、准确 checkbox index 和 confidence，证据绑定 archive SHA-256 与解压 tree；确定性 fixture 还必须匹配 artifact 中的 `expected.classId`/`expected.confidence`。各种证据不能互相替代。

CI 的独立最低版本任务下载并实际运行 Chromium 116 与 Firefox Desktop 140，同时设置 `REQUIRE_EXACT_MINIMUM_BROWSER=true`；更高的当前浏览器会被拒绝，不能冒充最低版本覆盖。GitHub runner 当前不能真实自动化 Firefox Android 142。发布可供商店审核的内置模型扩展 artifact 时，必须把 `firefox_android_e2e_run_id` 指向一个成功的外部测试 run；该 run 的命名 artifact 必须包含对同一 Firefox ZIP（名称、长度、SHA-256）的 Android 142 成功推理证据。缺失证据、版本不是 142、使用随机回退或 archive 不一致都会使 release preflight 失败。

手动触发 `Repository CI` 时可选择 `publish_extension_release=true`，从 `main` 创建当前版本对应的 `extension-v0.1.1` GitHub Release，并附带远程模型版 Chromium/Firefox ZIP、SHA-256 与 artifact 元数据。该入口默认关闭，要求完整仓库门禁、双浏览器 smoke、最低桌面版本和受保护 Key 的真实远程推理全部通过；远程 Release 与内置模型 artifact 都必须等待本次 CodeQL 分析作业成功，分析成功不代表没有安全告警；它不发布到浏览器商店，也不声称 Firefox Android 已验证。内置模型 artifact 仍使用 `publish_extension_artifact=true` 和独立 Android 142 证据。完整格式与受保护 CI 环境配置见 [`docs/browser-extension.md`](../../docs/browser-extension.md)。

校验本地旧版 ONNX 模型：

```bash
MODEL_FILE=/path/to/yolo26n-640.onnx \
pnpm --filter @hv-pony-solver/userscript verify-model-integrity
```

`verify-model-integrity` 使用 [packages/shared/src/model.ts](../../packages/shared/src/model.ts) 中的旧版 ONNX 长度和 SHA-256。当前 ORT 输入由 `build:packaged` 按 [ort-assets.ts](../../packages/shared/src/ort-assets.ts) 校验；两种模型的完整性清单分别维护。

`mise exec -- pnpm benchmark:extension:product` 要求本地固定的 `model/yolo26n-640.ort` 和可运行的 Chromium。它默认连续识别 100 次，可传入 `--iterations 1000` 延长运行；另测冷/热 `prepare`、四标签页并发、20 次取消尝试后恢复（分别记录实际取消和抢先完成次数）、4000×4000 合成图片和缓存关闭后重新命中。报告写入 `apps/extension/dist/product-benchmark/product-benchmark.json`。识别使用正式内置模型 ZIP 和真实 content client → broker → Offscreen → Worker → ORT；缓存阶段使用生产下载器与 IndexedDB，仅通过 localhost 回放下载确认，不访问生产 Key 或模型服务。该基准与原有 transport 矩阵独立，不作为发布证据或 CI 性能门槛。

合成纯白 PNG 只用于固定负载，不能证明识别准确率。报告给出 P50/P95、模型 GET/确认/二进制与元数据写入次数，以及连续识别前后的 CDP 堆快照；未测量的 WASM/网络缓冲峰值和 Port/监听器总数保留为 `null`，不把快照变化解释为泄漏证明。比较候选版本时应使用同一机器、浏览器、模型、迭代数与空闲系统状态。

## Model Worker 命令

```bash
pnpm --filter @hv-pony-solver/model-worker render-config
pnpm --filter @hv-pony-solver/model-worker exec node scripts/validate-wrangler-config.mjs
pnpm --filter @hv-pony-solver/model-worker dev
pnpm --filter @hv-pony-solver/model-worker typecheck
pnpm --filter @hv-pony-solver/model-worker test
pnpm --filter @hv-pony-solver/model-worker build
```

为明确执行本工作区的部署脚本，部署 Model Worker 时必须显式使用：

```bash
pnpm --filter @hv-pony-solver/model-worker run deploy
```
