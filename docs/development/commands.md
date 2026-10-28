# 命令参考

从仓库根目录执行；简写 `pnpm` 假定 shell 已激活 mise，否则加 `mise exec --`。下面列的是独立入口，按需选择，不要整段顺序运行。测试准备与证据范围见[验证手册](verification.md)，发布门禁见[CI 与发布](releases.md)。命令以各包 `package.json` 为准。

## 工具链

| 工具    | 要求                            |
| ------- | ------------------------------- |
| Node.js | `24.22.1`，最低兼容 `>=24.22.1` |
| pnpm    | `12.11.2`                       |

[mise.toml](../../mise.toml) 是本地与 CI 的版本来源。首次安装：

```bash
mise trust
mise install
mise exec -- pnpm install --frozen-lockfile
```

安装后运行 `mise exec -- pnpm check`；Worker 自动生成[隔离测试配置](verification.md#model-worker-测试配置)，不需预先运行 `render-config`。

## 仓库级命令

| 命令                                    | 作用                                                             |
| --------------------------------------- | ---------------------------------------------------------------- |
| `pnpm build`                            | 构建所有工作区；用户脚本采用默认外部 Runtime                     |
| `pnpm format:check`                     | 检查第一方格式，排除生成物、第三方资产与 pnpm 锁文件             |
| `pnpm format`                           | 全仓格式写入；日常修改优先只格式化指定文件                       |
| `pnpm lint`                             | ESLint                                                           |
| `pnpm typecheck`                        | 各工作区 TypeScript 检查                                         |
| `pnpm test`                             | 工作区普通测试，然后执行 `test:root`                             |
| `pnpm test:root`                        | 仅运行根级 `scripts/**/*.test.mjs`，不调度工作区                 |
| `pnpm test:coverage`                    | 工作区覆盖率；不含根级 Node 测试                                 |
| `pnpm audit:high`                       | 依赖安全审计，high 及以上失败                                    |
| `pnpm docs:check`                       | 事实漂移、命令、本地链接/锚点、决策结构与归档封印                |
| `pnpm architecture:check`               | 跨层、跨应用和类型导入边界                                       |
| `pnpm browser-sinks:check`              | 浏览器危险调用门禁                                               |
| `pnpm bundle:check`                     | 构建未压缩默认用户脚本并检查 `256 KiB` 预算                      |
| `pnpm bundle:check:default`             | 检查当前默认 profile 产物的 `256 KiB` 预算                       |
| `pnpm bundle:check:bundled`             | 检查当前内置 Runtime profile 产物的 `1 MiB` 预算                 |
| `pnpm extension:package-check`          | 构建远程模型双浏览器扩展并执行 Firefox 严格 lint                 |
| `pnpm extension:package-check:packaged` | 构建确定性内置模型 fixture，仅用于测试                           |
| `pnpm check:shared`                     | shared 类型、测试、构建                                          |
| `pnpm check:browser-core`               | browser-core 类型、测试                                          |
| `pnpm check:userscript`                 | 用户脚本类型、测试、默认构建                                     |
| `pnpm check:extension`                  | 扩展类型、测试、双目标构建及 Firefox 严格 lint                   |
| `pnpm check:model-worker`               | Model Worker 类型、测试、构建                                    |
| `pnpm build:onnx-runtime`               | 从固定上游构建精简 ORT；前提见[Runtime 专题](../onnx-runtime.md) |
| `pnpm verify:onnx-runtime`              | 校验随仓库分发的精简 glue                                        |
| `pnpm release:notes`                    | 向标准输出生成旧版 ONNX 清单的发布说明，不执行发布               |

聚合检查的顺序由根包脚本定义：

| 命令               | 执行顺序                                                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check:quick` | `format:check`、`lint`、`typecheck`、`test`、`docs:check`、`architecture:check`、`browser-sinks:check`、`extension:package-check`、`bundle:check`                                |
| `pnpm check`       | `format:check`、`lint`、`typecheck`、`test:coverage`、`test:root`、`docs:check`、`architecture:check`、`browser-sinks:check`、`extension:package-check`、`bundle:check`、`build` |

`check` 直接执行一次工作区覆盖率测试和一次根级 Node 测试，不先调用 `check:quick` 重跑普通工作区测试；`check:quick` 的普通测试行为不变，覆盖率门槛和各项静态/构建门禁不变。

浏览器 E2E 不在以上聚合检查内：

| 命令                                             | 构建与证明范围                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| `pnpm test:e2e:userscript`                       | 用户脚本 Playwright Chromium 测试                                      |
| `pnpm check:e2e`                                 | `test:e2e:userscript` 的别名                                           |
| `pnpm test:e2e:extension:content`                | 临时确定性 Host 的 Chromium 内容脚本整链 fixture                       |
| `pnpm test:e2e:extension:chromium:load-only`     | 先构建 remote，验证 Chromium 加载和普通设置                            |
| `pnpm test:e2e:extension:firefox:load-only`      | 先构建 remote，验证实际 Firefox ZIP 和设置控件                         |
| `pnpm test:e2e:extension:chromium:authenticated` | 先构建 remote，再用受保护 `KvKey` 下载并完成真实 `detect`；缺 Key 失败 |
| `pnpm test:e2e:extension:packaged`               | 先构建 fixture，再执行 Chromium/Firefox 无 Key 推理                    |

`benchmark:inference` 先预热一个批次，再报告 7 批次的每次操作耗时中位数；RGBA 预处理每批 100 次，YOLO 解析每批 1000 次。比较时使用相同 Node/机器与输入，真实浏览器整链耗时另测。

性能入口彼此独立。transport 矩阵只测浏览器 Blob 复制和全缓冲 digest，不测扩展消息或推理；product 才测实际链路。smoke 和合成图片不提供识别准确率或发布证据：

| 命令                                  | 负载与用途                                                                |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm benchmark:inference`            | 推理预处理/解析基准，不作 CI 性能门槛                                     |
| `pnpm benchmark:extension`            | 有界 Chromium transport smoke：4 场景、1,600 次操作、约 201 MiB           |
| `pnpm benchmark:extension:quick`      | 降低采样的 Chromium smoke，不能作性能比较                                 |
| `pnpm benchmark:extension:full`       | 双浏览器代表性矩阵：16 场景、343,200 次操作、约 335 GiB；仅有意比较时执行 |
| `pnpm benchmark:extension:exhaustive` | 完整 transport 尺寸矩阵，成本高于 full                                    |
| `pnpm benchmark:extension:product`    | 本地固定模型的 Chromium 真实推理与 localhost 缓存/确认回放                |

## 用户脚本命令

```bash
pnpm --filter @hv-pony-solver/userscript build
pnpm --filter @hv-pony-solver/userscript build:bundled-runtime
pnpm --filter @hv-pony-solver/userscript typecheck
pnpm --filter @hv-pony-solver/userscript test
pnpm --filter @hv-pony-solver/userscript test:coverage
pnpm --filter @hv-pony-solver/userscript test:e2e
pnpm --filter @hv-pony-solver/userscript benchmark:inference
pnpm --filter @hv-pony-solver/userscript verify:onnx-runtime
```

`build:external-runtime` 是默认 `build` 的显式别名；`verify-onnx-runtime-assets` 与 `verify:onnx-runtime` 等价。两种构建覆盖同一输出，须分别执行“构建 → 对应预算检查”，步骤见[用户脚本指南](../usage/userscript.md)。

`benchmark:inference` 每次在应用 `.tmp/` 下创建独立临时目录，只清理本次目录；并发成功或失败不删除另一进程的输入/输出。此并发回归纳入用户脚本 `test` 与 `test:coverage`。解析阶段使用生产 `parseYoloOutputTensor`，包含严格逐行验证，测试张量和维度在计时外创建；不能直接与旧宽松解析器的报告比较。

旧版 ONNX 校验单独执行：

```bash
MODEL_FILE=/path/to/yolo26n-640.onnx \
pnpm --filter @hv-pony-solver/userscript verify-model-integrity
```

它使用 [model.ts](../../packages/shared/src/model.ts) 的 ONNX 清单；当前 ORT 由扩展 `build:packaged` 按 [ort-assets.ts](../../packages/shared/src/ort-assets.ts) 校验，二者不能替代。

## 浏览器扩展命令

```bash
pnpm --filter @hv-pony-solver/extension typecheck
pnpm --filter @hv-pony-solver/extension test
pnpm --filter @hv-pony-solver/extension test:coverage
pnpm --filter @hv-pony-solver/extension build
pnpm --filter @hv-pony-solver/extension build:packaged
pnpm --filter @hv-pony-solver/extension build:packaged:fixture
```

`build:packaged` 要求本地固定 `model/yolo26n-640.ort`；fixture 不是可发布模型。以下工作区 E2E（content 除外）复用已有产物，选择对应构建后再运行；根级 remote/packaged E2E 则先构建。Firefox 需要 geckodriver，内置模型 Firefox smoke 还需要 OpenSSL，详见[扩展手册](../browser-extension.md)。

```bash
pnpm --filter @hv-pony-solver/extension test:e2e:content
pnpm --filter @hv-pony-solver/extension test:e2e:chromium:load-only
pnpm --filter @hv-pony-solver/extension test:e2e:chromium:authenticated
pnpm --filter @hv-pony-solver/extension test:e2e:firefox:load-only
pnpm --filter @hv-pony-solver/extension test:e2e:packaged:chromium
pnpm --filter @hv-pony-solver/extension test:e2e:packaged:firefox
pnpm --filter @hv-pony-solver/extension test:e2e:packaged
```

`test:e2e:chromium` 是 load-only 别名。`test:e2e:packaged` 依次执行两个桌面浏览器；最低版本与 Android 证据见[验证手册](verification.md#浏览器证据边界)。

根基准命令转发到扩展工作区的对应入口；CI 使用 `pnpm --filter @hv-pony-solver/extension benchmark:ci`，与 `benchmark` 相同。比较两份已有报告：

```bash
pnpm --filter @hv-pony-solver/extension benchmark:compare -- BASELINE_JSON CANDIDATE_JSON [OUTPUT_JSON]
```

比较器要求完整报告的 invocation/warmup/measured 数量与各自 config 一致，索引连续且唯一；满足最低数量或重新计算 summary 都不能让截短报告通过。显式降低采样的 smoke 同样必须匹配其声明数量，不能作为正式比较证据。

product 基准要求固定 ORT 模型和 Chromium，默认连续识别 100 次，支持 `--iterations 1000`。它测量冷/热 `prepare`、四标签页并发、20 次取消尝试及恢复、4000×4000 合成图片和缓存关闭后命中；实际取消与抢先完成分别计数。推理使用正式内置 ZIP 的 content client → broker → Offscreen → Worker → ORT，缓存使用生产下载器/IndexedDB 的 localhost 回放，不读取生产 Key。

报告位于 `apps/extension/dist/product-benchmark/product-benchmark.json`，包括 P50/P95、GET/确认/写入次数和前后 CDP 堆快照。WASM/网络缓冲峰值与 Port/监听器总数未测量，保留 `null`；快照不证明泄漏，纯白 PNG 不证明准确率。比较版本须保持机器、浏览器、模型、迭代数和空闲状态一致。

## Model Worker 命令

测试会自动生成[隔离配置](verification.md#model-worker-测试配置)，`typecheck`/`build` 不读取 Wrangler 配置。仅 `render-config`、`dev`、`deploy` 需按[运维手册](../model-worker-ops.md)准备绑定；显式渲染会覆盖工作区根的生成 `wrangler.toml`。以下是独立命令，不要整段顺序执行。

```bash
pnpm --filter @hv-pony-solver/model-worker render-config
pnpm --filter @hv-pony-solver/model-worker exec node scripts/validate-wrangler-config.mjs
pnpm --filter @hv-pony-solver/model-worker dev
pnpm --filter @hv-pony-solver/model-worker typecheck
pnpm --filter @hv-pony-solver/model-worker test
pnpm --filter @hv-pony-solver/model-worker test:coverage
pnpm --filter @hv-pony-solver/model-worker build
```

线上探测和部署分别执行，均不属于普通本地检查：

```bash
pnpm --filter @hv-pony-solver/model-worker check:deployment
```

只有明确授权发布且配置完整时才部署；必须写 `run deploy`，确保调用本工作区脚本：

```bash
pnpm --filter @hv-pony-solver/model-worker run deploy
```
