# 审计优化实施记录

依据 [2026-09-07 审计](../audits/2026-09-07-repository-audit.md)与[目录方案](directory-layout.md)实施。本页记录已经完成的范围、迁移过程和验证；目录、模块、文档及根配置改动已纳入本地提交 `ef5efc9`。长期维护步骤见[开发与验证](verification.md)。

## 目标与范围

1. 补强架构规则：禁止方向同时覆盖包名、深层相对路径与反向类型依赖；保留推理/UI 之间有意允许的类型契约。
2. 按目录方案迁移扩展和根级脚本，更新包命令、源码/测试引用、工作流、生成路径与文档，不保留旧脚本转发壳。
3. 把共享包的通配导出改为经过调用者盘点的显式接口，保持现有合法消费者可用。
4. 拆分扩展协议、基准契约与场景集中的测试，使同一目录和模块聚焦一项职责；保持协议字段、错误、超时、取消和资产身份。
5. 明确第一方格式检查范围，修正已确认的格式债务，补充文档链接校验并接入日常检查。
6. 更新维护文档、目录现状与必要的接口注释，以源码和新验证证据为依据。

不把所有长文件都强制拆分。Broker、Offscreen、核心缓存/Worker 的状态所有权若没有清晰的独立边界，保留现有组合结构；CI 的初始化复用属于可选评估，不改变现有 job 权限、触发条件和发布证据。

## 行为锁定与执行顺序

| 批次 | 执行内容                          | 修改前/后证据                                                                |
| ---- | --------------------------------- | ---------------------------------------------------------------------------- |
| 1    | 架构规则与回归用例                | 先复现深层路径与 type-only 漏检，再通过规则测试和实际架构检查                |
| 2    | 扩展脚本迁移                      | 原脚本测试基线；移动后相同套件、双目标构建与 E2E                             |
| 3    | 根脚本迁移                        | 根测试基线；移动后同一测试集合、根命令、工作流/文档契约                      |
| 4    | 显式导出、协议/基准与大型测试拆分 | 调用者盘点、已有测试；拆分后用例保留、类型与构建验证                         |
| 5    | 格式和文档门禁、接口说明          | 独立格式范围、失效链接回归、全部维护文档与漂移检查                           |
| 6    | 集成验收                          | 完整 `pnpm check`、Action 固定、两个用户脚本 profile、对应扩展构建/E2E、diff |

文件移动与行为修正分批进行，依赖前一批路径的工作等迁移完成后再展开。实施者与审阅者分开；集成时核对共享文件和原有未提交修改。

## 回退与兼容分类

- GM 敏感存储失败关闭、普通设置的既有兼容路径、历史记录兼容读取：有边界与测试的既有行为，保留。
- 远程/内置模型和用户脚本 Runtime profile：有意独立的产品路径，不合并为自动回退。
- Port 查询的有限重连、取消传播、超时与旧代际拒绝：有明确语义的恢复机制，保留。
- 为迁移留下永久旧路径转发或放宽校验以通过测试：会隐藏漏改引用，本次不采用。
- 未发现需要在本次目录整理中新增的兼容层或依赖。

## 路径与测试发现契约

扩展直属脚本进入子目录后，以模块自身位置推导 `extensionRoot = resolve(import.meta.dirname, '../..')`，再由 `extensionRoot/../..` 得到仓库根；已有 `scripts/build/`、`scripts/browser/` 模块保持原深度，不重复增加父级。根脚本进入子目录后，以 `resolve(import.meta.dirname, '../..')` 得到仓库根。shell 入口按同样的实际目录深度核对 `SCRIPT_DIR`，不依赖进程 cwd。显式输入/输出路径的现有 cwd 语义保持。

逐文件映射如下；未列出的已有子目录文件只更新必要引用，不移动：

| 迁移前路径                                                   | 迁移后路径                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| `apps/extension/scripts/build-extension.mjs`                 | `apps/extension/scripts/build/build-extension.mjs`                    |
| `apps/extension/scripts/build-extension.test.mjs`            | `apps/extension/scripts/build/build-extension.test.mjs`               |
| `apps/extension/scripts/build-packaged-fixture.mjs`          | `apps/extension/scripts/build/build-packaged-fixture.mjs`             |
| `apps/extension/scripts/benchmark-compare.mjs`               | `apps/extension/scripts/benchmark/benchmark-compare.mjs`              |
| `apps/extension/scripts/benchmark-contract.mjs`              | `apps/extension/scripts/benchmark/benchmark-contract.mjs`             |
| `apps/extension/scripts/benchmark-contract.test.mjs`         | `apps/extension/scripts/benchmark/benchmark-contract.test.mjs`        |
| `apps/extension/scripts/benchmark-product.mjs`               | `apps/extension/scripts/benchmark/benchmark-product.mjs`              |
| `apps/extension/scripts/benchmark-runner.mjs`                | `apps/extension/scripts/benchmark/benchmark-runner.mjs`               |
| `apps/extension/scripts/benchmark-runner.test.mjs`           | `apps/extension/scripts/benchmark/benchmark-runner.test.mjs`          |
| `apps/extension/scripts/browser-support.mjs`                 | `apps/extension/scripts/browser/browser-support.mjs`                  |
| `apps/extension/scripts/browser-support.test.mjs`            | `apps/extension/scripts/browser/browser-support.test.mjs`             |
| `apps/extension/scripts/install-geckodriver.mjs`             | `apps/extension/scripts/browser/install-geckodriver.mjs`              |
| `apps/extension/scripts/install-geckodriver.test.mjs`        | `apps/extension/scripts/browser/install-geckodriver.test.mjs`         |
| `apps/extension/scripts/webdriver.test.mjs`                  | `apps/extension/scripts/browser/webdriver.test.mjs`                   |
| `apps/extension/scripts/chromium-content-smoke.mjs`          | `apps/extension/scripts/e2e/chromium-content-smoke.mjs`               |
| `apps/extension/scripts/chromium-load-smoke.mjs`             | `apps/extension/scripts/e2e/chromium-load-smoke.mjs`                  |
| `apps/extension/scripts/chromium-load-smoke.test.mjs`        | `apps/extension/scripts/e2e/chromium-load-smoke.test.mjs`             |
| `apps/extension/scripts/chromium-packaged-model-smoke.mjs`   | `apps/extension/scripts/e2e/chromium-packaged-model-smoke.mjs`        |
| `apps/extension/scripts/firefox-load-smoke.mjs`              | `apps/extension/scripts/e2e/firefox-load-smoke.mjs`                   |
| `apps/extension/scripts/firefox-packaged-model-smoke.mjs`    | `apps/extension/scripts/e2e/firefox-packaged-model-smoke.mjs`         |
| `apps/extension/scripts/packaged-e2e-evidence.mjs`           | `apps/extension/scripts/e2e/packaged-e2e-evidence.mjs`                |
| `apps/extension/scripts/packaged-smoke-artifact.mjs`         | `apps/extension/scripts/e2e/packaged-smoke-artifact.mjs`              |
| `apps/extension/scripts/packaged-smoke-artifact.test.mjs`    | `apps/extension/scripts/e2e/packaged-smoke-artifact.test.mjs`         |
| `apps/extension/scripts/download-canonical-model.mjs`        | `apps/extension/scripts/model/download-canonical-model.mjs`           |
| `apps/extension/scripts/download-canonical-model.test.mjs`   | `apps/extension/scripts/model/download-canonical-model.test.mjs`      |
| `apps/extension/scripts/generate-packaged-fixture.sh`        | `apps/extension/scripts/fixtures/generate-packaged-fixture.sh`        |
| `apps/extension/scripts/requirements-lock.test.mjs`          | `apps/extension/scripts/fixtures/requirements-lock.test.mjs`          |
| `apps/extension/scripts/write-packaged-fixture-identity.mjs` | `apps/extension/scripts/fixtures/write-packaged-fixture-identity.mjs` |
| `apps/extension/scripts/release-gate.mjs`                    | `apps/extension/scripts/release/release-gate.mjs`                     |
| `apps/extension/scripts/release-gate.test.mjs`               | `apps/extension/scripts/release/release-gate.test.mjs`                |
| `scripts/check-architecture-boundaries.mjs`                  | `scripts/checks/check-architecture-boundaries.mjs`                    |
| `scripts/check-architecture-boundaries.test.mjs`             | `scripts/checks/check-architecture-boundaries.test.mjs`               |
| `scripts/check-browser-sinks.mjs`                            | `scripts/checks/check-browser-sinks.mjs`                              |
| `scripts/check-browser-sinks.test.mjs`                       | `scripts/checks/check-browser-sinks.test.mjs`                         |
| `scripts/check-bundle-budget.mjs`                            | `scripts/checks/check-bundle-budget.mjs`                              |
| `scripts/check-bundle-budget.test.mjs`                       | `scripts/checks/check-bundle-budget.test.mjs`                         |
| `scripts/assert-pinned-actions.mjs`                          | `scripts/ci/assert-pinned-actions.mjs`                                |
| `scripts/assert-pinned-actions.test.mjs`                     | `scripts/ci/assert-pinned-actions.test.mjs`                           |
| `scripts/benchmark-workflow-cost.test.mjs`                   | `scripts/ci/benchmark-workflow-cost.test.mjs`                         |
| `scripts/node-version-contract.test.mjs`                     | `scripts/ci/node-version-contract.test.mjs`                           |
| `scripts/workflow-security-contract.test.mjs`                | `scripts/ci/workflow-security-contract.test.mjs`                      |
| `scripts/check-docs-drift.mjs`                               | `scripts/docs-drift/check-docs-drift.mjs`                             |
| `scripts/check-docs-drift.test.mjs`                          | `scripts/docs-drift/check-docs-drift.test.mjs`                        |
| `scripts/model-manifest.mjs`                                 | `scripts/model/model-manifest.mjs`                                    |
| `scripts/model-manifest.test.mjs`                            | `scripts/model/model-manifest.test.mjs`                               |
| `scripts/model-release-notes.mjs`                            | `scripts/model/model-release-notes.mjs`                               |
| `scripts/model-release-notes.test.mjs`                       | `scripts/model/model-release-notes.test.mjs`                          |
| `scripts/assert-clean-ort-source.mjs`                        | `scripts/ort-runtime/assert-clean-ort-source.mjs`                     |
| `scripts/assert-clean-ort-source.test.mjs`                   | `scripts/ort-runtime/assert-clean-ort-source.test.mjs`                |
| `scripts/build-minimal-ort-runtime.sh`                       | `scripts/ort-runtime/build-minimal-ort-runtime.sh`                    |
| `scripts/build-minimal-ort-runtime.test.mjs`                 | `scripts/ort-runtime/build-minimal-ort-runtime.test.mjs`              |
| `scripts/resolve-ort-build-root.mjs`                         | `scripts/ort-runtime/resolve-ort-build-root.mjs`                      |
| `scripts/resolve-ort-build-root.test.mjs`                    | `scripts/ort-runtime/resolve-ort-build-root.test.mjs`                 |
| `scripts/run-userscript-e2e.mjs`                             | `scripts/e2e/run-userscript-e2e.mjs`                                  |

迁移者负责本目录内 imports、`new URL`、fixture、根目录推导和包内测试发现；父代理负责根 package、跨工作区调用、两个 workflow、README、AGENTS 与维护文档引用。扩展 Node 测试固定使用 `node --test "scripts/**/*.test.mjs"`，由 Node 递归展开带引号的 glob，coverage 也使用相同递归集合并更新 artifact/release 的 include 路径。根 Node tests 同样保持带引号的 `scripts/**/*.test.mjs`。拆分前后保存并比较测试名集合和数量，原扩展 65 个 Node 测试与所有根测试必须全部出现；零匹配、少测或跳过既有用例均视为失败。

每个入口核对由 package script 启动、从仓库根/工作区/其他 cwd 启动的路径语义；有 `--repo-root` 的入口还验证显式根。CI canonical gate 的直接 Node 测试路径、docs-drift 对 browser-support 的读取、测试内的临时仓库布局必须一起迁移。根目录推导的测试应断言真实资源路径，不能只断言新字符串存在。

架构检查保留现有 specifier 规则，并对相对导入按源文件目录解析为 repo-relative 路径，匹配禁止的源码目录。覆盖 import、re-export、字符串动态 import、显式/内联 type-only、嵌套目录、规范化路径和合法相邻目录；只有层间有意允许的类型契约可以例外。

跨应用规则的诊断名称准确描述所有禁止方向，例如 Model Worker 禁止 browser applications/browser core；同步测试断言，不能用“导入 userscript”描述实际的核心包违规。

## 工作区保护与拆分边界

已经保存本轮开始时的 status/diff，并备份了生成的 Worker 配置；测试期间仅使用占位绑定，结束后恢复原生成配置。已有用户改动只能保留或随文件迁移，不执行 reset、checkout、clean 或未经要求的提交。每批核对原有 diff，父代理集中编辑共享配置，避免并行覆盖。

模块拆分必须先说明独立输入输出、状态所有者与清理责任；没有独立边界时保留组合入口。协议按 Port、Offscreen、图片负载分组，类型与 guard 靠近；基准按参数/矩阵、统计、结果校验与比较分组。模型缓存、Broker、Offscreen 的共享状态没有必要为了行数改成新框架。

历史审计正文保留审计时的数字和旧路径语境；可点击链接与可执行示例更新到当前入口，并标明后续实施状态。维护文档和真实代码的失效路径必须清理，不能以历史快照为由跳过当前命令。

## 完成标准

两级脚本不再平铺混合职责文件，公开命令可用，实际代码引用和维护文档不指向被删除路径；资产身份、权限、消息和持久化行为保持；新增规则能够拒绝原先漏检的输入。记录通过的命令及环境限制，不把未运行的受保护鉴权、最低版本或 Android 验证描述为完成。

## 进度

已完成选定的目录、接口、模块与门禁改动，最终集成复验通过，默认生成物与原有 Worker 生成配置已恢复。

| 项目        | 实施结果                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| 脚本目录    | 迁移扩展 30 个、根级 24 个文件；两级 `scripts/` 直属文件均为 0；文档测试集中在 `scripts/docs-drift/test/`          |
| 架构门禁    | 补充相对路径真实解析、路径规范化、反向类型依赖及准确诊断；CLI 默认根同样拒绝缺失的受保护目录；回归由 26 增至 38 个 |
| 包接口      | `browser-core`、`shared` 改为显式 exports；验证合法消费者和未公开子路径的真实 Node 解析                            |
| 扩展协议    | Port、Offscreen、图片与共用校验分组，`messages.ts` 保持原公共接口的显式聚合；17 个协议测试名称不变                 |
| 基准模块    | 参数/矩阵、统计、结果校验、比较、CSV 分离；去掉聚合入口与比较器的新循环依赖；保持 schema、默认成本和结果           |
| Worker 测试 | 原 `index.test.ts` 拆为四个领域文件，117 个 Vitest 测试名称全部保留                                                |
| 文档测试    | 原大文件拆为六个领域测试，公共 fixture 与源码字面量测试归入 test 目录；原有根测试全部保留                          |
| 格式        | 增加 `format:check` 与生成物/vendor/锁文件排除规则，接入 `check:quick` 和 CI；修正第一方格式债务                   |
| 文档链接    | 增加文件/目录/锚点、真实路径与失败关闭检查；7 个行为测试包含 symlink 目标和 symlink 仓库根；接入 `docs:check`      |
| 文档与注释  | 更新导航、当前目录、模块关系、验证命令与测试地图；补充公共存储、答案和令牌契约注释；历史审计数字保留               |

迁移后的 `check-docs-drift.test.mjs` 又按场景拆分，最终入口是 `scripts/docs-drift/test/*.test.mjs`；上方逐文件表记录最初迁移步骤，不要求保留中间的大测试文件。

## 验证证据

| 验证               | 结果与边界                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`       | 最终完整链路通过：含 234 个根测试、五工作区测试、类型/Lint、格式/文档/架构门禁、覆盖率和构建                                                |
| 用户脚本 E2E       | Chromium 上 1 个本地 fixture 测试通过，使用模拟 detector                                                                                    |
| 扩展内容 E2E       | 自动/手动答题、一次提交、历史、排除路由与 BFCache 恢复通过                                                                                  |
| 远程扩展加载       | Chromium 152.0.7977.82 与 Firefox 140.15 加载/设置检查通过；不使用 Key                                                                      |
| 内置 fixture 推理  | Chromium 152 验证 Worker/后台重启、旧 epoch 取消、Offscreen 空闲销毁与重建；Firefox 140.15.0 完成两次推理/会话重建，启用精确最低 major 检查 |
| transport CI smoke | 4 个场景、1,600 次操作、210,534,400 字节负载通过；不作为性能提升或产品推理准确率证据                                                        |
| 用户脚本预算       | 未压缩 external 为 188,575 字节，bundled 为 271,271 字节，分别通过 256 KiB / 1 MiB 门禁                                                     |
| 路径与独立审阅     | 核对默认路径、其他 cwd、显式 repo root 与 symlink root；协议/基准行为及原有 CI 权限、工具链和发布门禁已独立审阅                             |

真实浏览器验收发现并修正了迁移后 Chromium packaged smoke 的默认根路径，以及 Firefox CLI/WebDriver 的 `140.15` / `140.15.0` 表示差异。版本比较只规范化末尾零，仍拒绝不同补丁版本和无效值，新增回归后扩展 Node 测试由 65 增至 66 个。

本轮未使用受保护 Key、未执行生产模型下载/鉴权、未运行 Chromium 116、Firefox Android 142 或生产部署。内置推理使用确定性的 fixture 模型，不代表 canonical 模型准确率。Broker、Offscreen、核心缓存/Worker 协调器和 CI 初始化复用保留原结构；其状态所有权或收益尚不足以支持本轮进一步拆分。

验收后默认扩展产物恢复为 remote，目录中不包含 `.ort`；用户脚本恢复为 external profile。已测试的 fixture ZIP 和浏览器证据留作本地临时验收材料，生成的 Worker 配置按实施前备份恢复。随后按用户要求创建本地提交 `ef5efc9`；该次交付没有执行推送或发布。

## 根配置精简

已按本节计划完成根配置精简，根目录减少两个配置文件：

1. 将 `prettier.config.js` 的四项规则原样放入根 `package.json#prettier`，删除独立文件；保留 `.prettierignore` 的独立忽略语义。
2. 删除未被当前 pnpm/CI 测试链使用的 `vitest.workspace.ts`；各工作区的 Vitest 配置和根 `pnpm -r test` 调度保持。
3. 合并 ESLint 重复的 TypeScript 规则，仅为两个日志模块覆盖 `no-console`。
4. 保留工具发现与职责需要的 `eslint.config.mjs`、共享 `tsconfig.base.json`、mise 和 pnpm 配置，并更新文档权威来源。

修改前捕获配置基线，实施后确认 10 个 Prettier 解析与忽略样例、7 个 ESLint 生效配置和根包及五个工作区的测试/类型检查命令完全一致；Prettier 从根、应用、共享包文件均能自动发现根 `package.json`。规则、测试集合、工具版本、工作区和依赖保持，已有未提交改动继续保留。

本次 `mise exec -- pnpm check` 完整通过，包含五工作区测试、234 个根测试、覆盖率、构建和全部静态门禁；Action 固定版本检查和 `git diff --check` 通过。测试使用占位 Worker 绑定，结束后按字节恢复原生成配置。本次仅修改管理配置和文档，未重新运行浏览器 E2E。

## 后续维护边界

上述通过数和浏览器版本属于实施时的验收记录。后续文档更新以当前源码、配置与命令为准，并单独运行格式、文档漂移、链接和相关回归；更新文档本身不会刷新这里的业务测试或浏览器证据。仍未执行的受保护鉴权、Chromium 116、Firefox Android 142 和生产发布保持原有独立门禁。
