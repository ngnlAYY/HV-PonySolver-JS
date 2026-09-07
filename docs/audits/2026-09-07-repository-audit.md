# 2026-09-07 仓库审计

本轮审计覆盖源码、目录、模块化、风格、注释、文档、测试与构建/CI 的维护结构，并补充维护者文档。核心结论：工作区和浏览器领域划分已有良好基础；优先改进架构门禁覆盖、脚本目录分组、公共导出面与文档导航，随后再处理职责集中的协议/基准模块和大型测试。

本报告记录初次审计时的工作区快照，包含当时已有的未提交工具链、CI 与文档修改。初次审计只新增文档及导航，没有移动源码、修改业务行为或提交 Git。优先级表示当时建议的维护顺序，不是安全漏洞等级。

后续实施及根配置精简已完成，并纳入提交 `ef5efc9`；迁移映射与验证证据见[实施记录](../development/implementation-plan.md)。下文数字、失败现象和验证范围保留初次审计时的语境；代码链接随迁移更新到当前入口，不表示原问题仍然存在。

## 后续处理状态

| 审计项  | `ef5efc9` 中的处理结果                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------- |
| A1      | 补齐相对路径与反向类型依赖检查，增加真实路径解析、缺失目录失败关闭和回归测试                            |
| A2      | 根与扩展两级脚本按职责迁移，直属文件均为 0                                                              |
| A3 / A9 | 补齐文档导航、架构与开发手册，并为公共存储、答案和令牌契约增加必要注释                                  |
| A4      | 清理第一方格式债务，将 `format:check` 接入本地与 CI；锁文件和第三方资产继续排除                         |
| A5      | `browser-core` 与 `shared` 改为显式 exports，保留经验证的现有调用者                                     |
| A6 / A7 | 已拆分协议、benchmark、Worker 与文档测试；Broker、Offscreen、核心缓存/Worker 协调器和缓存测试保留原结构 |
| A8      | 增加维护文档的本地链接/锚点门禁；架构时序与未纳入事实提取器的语义仍需人工核对                           |
| A10     | mise 工具链与脚本入口已统一；尚未抽取跨 job 初始化步骤，保留各 job 的权限和证据隔离                     |

根 Prettier 配置已合入 `package.json`，根 Vitest workspace 配置已删除，ESLint 公共规则已合并。完整检查与已执行浏览器场景的边界以[实施验证证据](../development/implementation-plan.md#验证证据)为准；当前目录数量见[实施后盘点](source-inventory.md#实施后盘点)。

## 范围与方法

写入本轮文档前，共盘点 372 个 Git 已跟踪或未忽略且实际存在的文件。排除 vendor 与 `other/` 目录下的 3 个文件后为 369 个自有维护文件。生成的模型、构建输出、coverage、Wrangler 配置、依赖与索引不作为业务源码。

| 区域                    | `src` 文件 / 行 | 测试及辅助代码文件 / 行 | 非测试脚本文件 / 行 |
| ----------------------- | --------------- | ----------------------- | ------------------- |
| `apps/extension`        | 47 / 4,542      | 41 / 8,733              | 28 / 6,005          |
| `apps/userscript`       | 28 / 1,180      | 26 / 5,201              | 5 / 607             |
| `apps/model-worker`     | 10 / 1,101      | 8 / 3,253               | 5 / 774             |
| `packages/browser-core` | 50 / 5,269      | 27 / 7,129              | 0                   |
| `packages/shared`       | 7 / 95          | 3 / 132                 | 0                   |
| 根 `scripts`            | 0               | 14 / 3,047              | 24 / 3,313          |
| 合计                    | 142 / 12,187    | 119 / 27,495            | 62 / 10,699         |

统计口径、各目录清单和复查方法见[文件盘点](source-inventory.md)。`src` 数量按路径统计，包含源目录内的测试专用 fixture hook；测试文件数包含 helper/setup/E2E，不等于 Vitest suite 数。行数包含空行与注释。

本轮执行了全量文件和 TypeScript AST 盘点；对 142 个源码文件的静态 import、re-export 与字符串动态导入检查工作区方向，得到 104 条跨工作区导入，未发现当前源码的反向依赖。进一步沿页面提交、取消、模型缓存/确认、扩展消息/Host、Worker 路由/额度和构建发布边界复核源码与测试。脚本、配置、文档和测试目录也全部纳入盘点，与现有测试覆盖对应的行为已纳入复核。

这不等于对每条测试断言作人工形式证明，也不覆盖计算生成的动态模块路径、任意别名解析、线上资源或全部浏览器环境。未对第三方压缩 Runtime 作逐行审查；其字节身份由项目资产契约约束。

## 优化优先级

| 编号 | 优先级 | 发现 / 建议                                                   | 置信度                     | 初次审计状态             |
| ---- | ------ | ------------------------------------------------------------- | -------------------------- | ------------------------ |
| A1   | P1     | 架构门禁漏掉 Worker 的核心相对路径导入和部分反向类型导入      | 高：规则与合成输入直接复现 | 已记录；规则待补强       |
| A2   | P1     | 扩展和根脚本目录混合职责，分别有 30 / 24 个直属文件           | 高：完整目录盘点           | 已提供逐组迁移方案       |
| A3   | P1     | 缺少维护者导航、全局架构、开发与注释规范                      | 高：原来仅有四篇专题       | 本轮补全文档             |
| A4   | P2     | 格式检查有 17 个现存文件失败，默认质量链未纳入 Prettier check | 高：当前工具实际检查       | 已记录；未批量格式化     |
| A5   | P2     | 内部包使用通配 exports，目录布局成为调用接口的一部分          | 高：包配置和现有导入       | 已给出收敛顺序           |
| A6   | P2     | 扩展协议、基准及部分生命周期协调器职责集中                    | 高（职责）；中（拆分收益） | 已定位拆分边界           |
| A7   | P2     | Worker、文档漂移和缓存测试的单文件场景过于集中                | 高（结构）；中（拆分收益） | 已给出领域拆分建议       |
| A8   | P2     | 漂移检查强依赖 README 与四篇专题，新文档不自动获得全量校验    | 高：检查器读取列表         | 已明确范围和联动方法     |
| A9   | P3     | 公共边界注释不均衡，现有关键不变量注释值得保留                | 高（现状）；中（补充范围） | 已补充注释指南与架构说明 |
| A10  | P3     | CI 重复初始化可以收敛，但需保留各 job 的隔离与证据            | 高（重复）；中（收益）     | 建议，未修改工作流       |

## A1：架构门禁覆盖不完整

初次审计时，[架构检查器](../../scripts/checks/check-architecture-boundaries.mjs)中的 `BOUNDARY_RULES` 对 Model Worker 的禁止列表包含 `@hv-pony-solver/browser-core`，却未覆盖等价的 `packages/browser-core/src` 相对路径；检查循环默认跳过 type-only 导入，只有少数规则显式设置 `includeTypeOnly`。这些缺口已在后续实施中修正。

直接使用检查器导出的解析和匹配函数，得到以下结果。合成输入只在内存中求值，没有写入业务源码或执行这些导入：

| 模拟来源                        | 导入示例                                                                                       | 规则结果 |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | -------- |
| `apps/model-worker/src`         | `import { App } from '../../../packages/browser-core/src/app/app'`                             | 未拦截   |
| `packages/shared/src`           | `import type { ExtensionSender } from '../../../apps/extension/src/platform/webextension-api'` | 未拦截   |
| `apps/model-worker/src`，对照组 | `import { App } from '@hv-pony-solver/browser-core/app/app'`                                   | 已拦截   |

因此，“当前 architecture:check 通过”只能证明现有规则通过，不能证明这些结构约束已被完整保护。全量源码导入盘点没有发现当前业务采用这些违规路径，本项不是已发生的运行时故障。

可在仓库根目录使用当前检查器复查同一组规则匹配结果：

```bash
mise exec -- node --input-type=module <<'JS'
import { BOUNDARY_RULES, extractImportSpecifiers, matchesForbiddenImport } from './scripts/checks/check-architecture-boundaries.mjs'

const probes = [
  ['apps/model-worker/src', "import { App } from '../../../packages/browser-core/src/app/app'"],
  ['packages/shared/src', "import type { ExtensionSender } from '../../../apps/extension/src/platform/webextension-api'"],
  ['apps/model-worker/src', "import { App } from '@hv-pony-solver/browser-core/app/app'"],
]
for (const [fromDir, source] of probes) {
  const imports = extractImportSpecifiers(source)
  const blocked = BOUNDARY_RULES.filter((rule) => rule.fromDir === fromDir).some((rule) =>
    imports.some((item) => (!item.typeOnly || rule.includeTypeOnly) &&
      rule.forbiddenImports.some((pattern) => matchesForbiddenImport(item.specifier, pattern))),
  )
  console.log({ fromDir, source, blocked })
}
JS
```

初次审计输出依次为 `blocked: false`、`false`、`true`；在 `ef5efc9` 上复查，三项均为 `blocked: true`。这验证解析与规则匹配层，不执行示例模块，也不替代真实路径回归和实际类型检查。

建议先为禁止方向增加合成回归用例，再统一包名与相对路径的判定，按每条规则的意图决定是否包含类型依赖。推理与 UI 间有意允许的 type-only 契约要保留；禁止 shared/核心反向依赖应用的规则则应覆盖类型。无需引入新架构框架。

## A2：先整理脚本目录

| 审计时目录                           | 直属文件数 | 观察                                                       |
| ------------------------------------ | ---------- | ---------------------------------------------------------- |
| `apps/extension/scripts`             | 30         | build、benchmark、smoke、模型下载、fixture、发布与测试并列 |
| 根 `scripts`                         | 24         | 质量门禁、工作流契约、模型、ORT、E2E 与测试并列            |
| `apps/extension/src/host`            | 14         | Host、资产、Key 存储、状态和 fixture；可按增长再分组       |
| `browser-core/src/captcha` / `model` | 各 12      | 已是领域分组，数量本身不构成问题                           |
| `apps/model-worker/src`              | 10         | 职责命名清楚，路由已有独立 handler 函数                    |
| `packages/shared/src`                | 7          | 小型纯契约，无需机械增加层级                               |

扩展脚本建议进入 `build/`、`benchmark/`、`browser/`、`e2e/`、`model/`、`fixtures/`、`release/`；根脚本进入 `checks/`、`ci/`、`docs-drift/`、`model/`、`ort-runtime/`、`e2e/`、`lib/`。完整文件映射、硬编码路径清单和验证顺序见[目录组织方案](../development/directory-layout.md)。

先移动且保留命令名，再独立做职责拆分。特别核对 `import.meta.dirname` 推导的 repo root、包内显式测试列表、CI、构建入口、文档漂移读取路径；单纯移动成功不代表功能不变。

## A3 / A8：文档缺口与漂移边界

审计开始时 README 为 911 行，同时承担用户入口、完整命令、资产表、HTTP 矩阵、安全和运维说明；`docs` 只有扩展、Runtime、缓存和 Worker 运维四篇专题。专题内容较充分，缺的是跨模块导航和“如何安全地改代码”的维护说明。

本轮新增 `docs/README.md`，按 `architecture/`、`development/`、`audits/` 分组补齐全局与分平台架构、验证指南、风格/注释约定、目录方案、文档维护和审计盘点；README 与 AGENTS 增加入口，并修正 README 中过时的 pnpm 版本措辞。

[文档检查器读取列表](../../scripts/docs-drift/check-docs-drift.mjs#L64)显式绑定 README 和四篇专题，[架构文档检查](../../scripts/docs-drift/architecture-docs.mjs#L37)部分使用关键词存在性判断。它不能证明新架构页的所有链接或时序正确。新增文档通过源码交叉审阅与独立链接检查验证；长期应扩展现有事实提取器的覆盖，而不是用更多必需关键词代替语义。

后续收敛 README 时逐节迁移深层解释，并同步漂移测试读取目标。现有专题路径保留，避免已有链接失效；不为本轮补全文档同时大规模删除既有契约正文。

## A4：代码风格的实际基线

正面证据：[TypeScript 配置](../../tsconfig.base.json)开启 `strict`、`noUncheckedIndexedAccess` 和 `exactOptionalPropertyTypes`；[ESLint](../../eslint.config.mjs)约束显式 `any`、未使用变量、类型导入和非日志模块的 `console`。142 个源码文件的 AST 中未发现显式 `any`；共发现 20 处非空断言、54 处类型断言，其中 1 处连续断言。这些计数只是定位线索，不能直接视为错误。

对 355 个自有、格式器支持的文件运行 Prettier，17 个文件未通过：

- `apps/extension/scripts/fixtures/requirements-lock.test.mjs`
- `apps/extension/src/platform/webextension-storage.ts`
- `apps/extension/test/fixtures/packaged-model/identity.json`
- `apps/extension/test/host/packaged-asset.test.ts`
- `apps/userscript/scripts/onnx-runtime-assets.test.mjs`
- `apps/userscript/scripts/verify-model-integrity.mjs`
- `apps/userscript/scripts/verify-model-integrity.test.mjs`
- `apps/userscript/src/app/app-dependencies.ts`
- `apps/userscript/src/inference/blob-worker.ts`
- `apps/userscript/test/inference/blob-worker.test.ts`
- `apps/userscript/test/inference/runtime-wasm-loader.test.ts`
- `packages/browser-core/test/model/model-integrity.test.ts`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `scripts/checks/check-browser-sinks.test.mjs`
- `scripts/docs-drift/architecture-docs.mjs`
- `scripts/docs-drift/extension-docs.mjs`

这里包含包管理器生成的锁文件，不应不加区分地批量修复。初次审计时默认 [check 链](../../package.json)没有 Prettier 检查，而 `format` 是全仓写操作。当时建议先明确第一方源码/文档的格式检查范围和 vendor/生成物排除，再清理已确认的格式债务，最后把只读格式检查纳入门禁；初次审计只格式化修改的文档。上述改进已在后续实施中完成。

## A5：公共导出与目录耦合

[browser-core](../../packages/browser-core/package.json#L6)与 [shared](../../packages/shared/package.json#L6)均以 `./*` 暴露源文件子路径。应用大量使用 `browser-core/inference/...`、`model/...`、`platform/...` 等路径。这些当前是合法 API，不是越界导入，但会增加未来文件移动的影响面。

建议先清点调用者，再按领域列出稳定入口并收紧 exports。保留必要的 type-only 接口，避免改成一个导出所有实现的大桶文件。纯重导出 shim 可在调用者迁移后删除；GM、Blob Worker、设置和 Key 注入适配器有独立语义，应继续保留。

## A6 / A7：按职责拆分模块与测试

| 热点                                                                                          | 审计时行数 | 当时建议评估的边界                                              |
| --------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------- |
| [扩展 messages.ts](../../apps/extension/src/protocol/messages.ts)                             | 541        | Port/Offscreen 协议、各自 guard、图片编解码；类型与校验保持靠近 |
| [核心 onnx-worker-client.ts](../../packages/browser-core/src/inference/onnx-worker-client.ts) | 510        | 模型/初始化准备与检测队列/恢复；先确认共享状态所有权            |
| [核心 model-downloader.ts](../../packages/browser-core/src/model/model-downloader.ts)         | 504        | 下载响应、回执/额度、Key 验证；复用已有有界流和 Fetch 工具      |
| [扩展 broker.ts](../../apps/extension/src/background/broker.ts)                               | 421        | 来源准入、Port/request 生命周期、凭证代际；保留组合入口         |
| [扩展 ordinary-settings.ts](../../apps/extension/src/options/ordinary-settings.ts)            | 403        | 字段定义、解析、脏字段与持久化队列                              |
| [扩展 offscreen-bootstrap.ts](../../apps/extension/src/offscreen/offscreen-bootstrap.ts)      | 336        | epoch/claim、活动请求、取消历史、空闲退避                       |
| [benchmark-contract.mjs](../../apps/extension/scripts/benchmark/benchmark-contract.mjs)       | 817        | 参数、矩阵、统计结果和证据验证                                  |
| [benchmark-runner.mjs](../../apps/extension/scripts/benchmark/benchmark-runner.mjs)           | 636        | 浏览器/页面初始化、采样、汇总和清理                             |
| [原 check-docs-drift.test.mjs](../../scripts/docs-drift/test/)                                | 1,586      | 按命令、资产、Worker、扩展、结构契约拆分测试                    |
| [原 Worker index.test.ts](../../apps/model-worker/test/)                                      | 1,382      | HTTP/CORS、模型/WASM、quota、异常与超时                         |
| [model-downloader.test.ts](../../packages/browser-core/test/model/model-downloader.test.ts)   | 1,171      | 流长度/哈希、HTTP 错误、额度与确认、取消                        |

大文件本身不等于不正确。上述建议依据同一文件内存在多条变化轴；拆分收益仍需在实施时用依赖关系和测试证明。Worker 的 `handleRequest` 主体约 55 行，已有多个独立处理函数，不属于本轮应优先拆解的协调器。

扩展的 canonical 模型下载和 geckodriver 安装都包含有界读取、取消和哈希处理，是潜在复用点；二者的凭据、URL、重定向和归档策略不同。先比较策略再复用底层原语，不能抽出无条件重试或放宽限制的通用下载器。基准的代码量也不能直接证明产品运行时慢，本轮未作性能比较。

测试拆分应保留场景和断言，公用 fixture 只共享稳定的输入构造，避免所有测试经一个大 helper 重现实现自身。取消、缓存事务、幂等和代际状态尤其需要行为回归证据。

## A9：注释情况

AST 盘点发现 142 个源码文件中 89 个没有注释，但其中包含短类型文件、适配器和纯重导出，不能据此要求每个文件加注释。关键区域已有说明，例如 [model-cache](../../packages/browser-core/src/model/model-cache.ts#L108)的缓冲区所有权、[IndexedDB store](../../packages/browser-core/src/model/indexeddb-model-store.ts#L203)的事务完成和身份绑定、[GM bridge](../../apps/userscript/src/userscript/gm-bridge.ts#L5)的敏感存储边界。

缺口主要在公共接口的前置条件、平台差异、调用方与被调用方的清理责任、为什么不能重试或回退。这些应以简短 TSDoc/模块注释补充，跨文件时序已由本轮架构页说明。无需批量翻译现有准确英文注释，也不以注释覆盖率作为质量目标。具体例子见[注释指南](../development/contributing.md#注释应该解释什么)。

## A10：CI 与脚本复用

[Repository CI](../../.github/workflows/verify-monorepo.yml)多个 job 重复 mise、pnpm store 缓存和冻结安装，可在后续评估小型复用步骤，但要保留 job 自身权限、触发条件、环境、超时和发布依赖。浏览器安装和受保护模型准备并不适用于全部 job，不能一概合并。

根 [scripts/lib](../../scripts/lib/)已有 CLI、direct-run、源码收集和字符串工具；新增脚本先复用已有功能。CI 的不同浏览器与模型证据是有意分层，不把这类重复当作可直接删除的冗余。根 Node tests 不属于 `pnpm -r test:coverage`，本轮已单独执行。

## 验证记录

| 检查                                     | 本轮结果                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| browser-core 测试                        | 26 个 Vitest 文件、389 个测试通过                                                             |
| userscript 测试                          | 20 个 Vitest 文件、203 个测试通过；包内 Node 构建/资产测试通过                                |
| extension 测试                           | 27 个 Vitest 文件、239 个测试通过；65 个 Node 脚本测试通过                                    |
| model-worker 测试                        | 5 个 Vitest 文件、117 个测试通过；56 个 Node 脚本测试通过                                     |
| shared 测试                              | 3 个文件、15 个测试通过                                                                       |
| 根 `scripts/**/*.test.mjs`               | 214 个测试通过，0 失败、0 跳过                                                                |
| 五个工作区 TypeScript 检查               | 通过                                                                                          |
| 根 ESLint                                | 通过                                                                                          |
| architecture / browser-sinks             | 当前规则通过；架构门禁覆盖缺口见 A1                                                           |
| Action 固定与 checkout 凭据检查          | 通过                                                                                          |
| 全量源码导入方向扫描                     | 142 个源码文件、104 条跨工作区静态导入，无当前违规                                            |
| 基线 Prettier                            | 17 个现存文件失败，已单独记录                                                                 |
| 新增/修改文档格式、相对链接、漂移及 diff | 13 个修改/新增 Markdown 的格式与 225 个相对链接/锚点通过；docs:check 与 git diff --check 通过 |

本轮没有运行完整 `pnpm check`：coverage、全仓生产构建、生产扩展打包审计和两个完整 bundle profile 没有作为本轮全套门禁执行。没有运行真实浏览器 E2E、真实 GM 管理器、受保护远程模型鉴权、最低浏览器版本或 Firefox Android 验证，也没有检查线上 Worker/KV/R2 或依赖漏洞数据库。测试和静态检查通过不代表这些边界已经验收。

## 初次审计建议的实施顺序

先补强 A1 的门禁回归，然后按目录方案分批迁移扩展脚本与根脚本；每批只处理路径。随后收敛公共导出，按已验证的变化轴拆分协议/基准和大型测试。格式基线和 README 收敛独立处理，避免把行为、路径、格式和长文档迁移混在一个 diff 中。
