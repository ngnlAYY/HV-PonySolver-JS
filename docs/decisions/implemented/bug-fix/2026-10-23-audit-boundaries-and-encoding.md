# Agent Note: 提交地址、编码长度与跨世界状态边界修复

Status: implemented

## Problem

全源码审计用真实 Chromium、原生 Node 和 workerd 确认五项问题：命名控件遮蔽 `form.action` 后绕过同源与目标身份检查；图片和模型混淆 HTTP 编码长度与 Fetch 解压后长度；同文档切换世界后面板仍向旧历史分区写入；扩展产物只审计 `.js` 而漏掉本地 `.mjs`；Worker 接受经 URL 规范化后串到其他路由或无法匹配的公开路径。

Key 验证原先以模型 HEAD 的长度区分真实模型与诱饵，合法压缩也会被判为无效 Key。此处需要改变验证依据，而不是在压缩头可见时增加特例。

## Decision

1. 提交地址统一通过 `Reflect.get(HTMLFormElement.prototype, 'action', form)` 读取原生 getter。目标发现、快照、同源检查和提交前复核共用该值，保留相对/绝对 URL 等价语义；命名控件不再覆盖地址。
2. 图片读取保留同源 MIME、声明上限、实际字节上限与取消规则。有内容编码时不将 `Content-Length` 当作解码后精确长度。模型始终按 canonical 实际长度与 SHA-256 校验，不依赖 CORS 是否暴露编码头；编码声明单独允许清单长度加 `max(64 KiB, ceil(清单长度 / 1024))`，该预算只容纳编码开销，不扩大实际模型容量。小声明只有同时伴随小正文时才保留诱饵永久拒绝分类。
3. 客户端 Key 验证完整切换到现有认证 `GET /quota`，复用有界 16 KiB JSON、超时、取消和 schema 校验。403 返回无效；合法耗尽或禁用额度仍有效。删除 HEAD 专用验证助手和无关完整性选项，不保留旧路径回退。Worker 的 HEAD 路由、下载回执和确认计次协议不变。
4. 原面板在创建、状态、历史活动和相关 DOM 恢复时同步当前世界，复用节点。写入捕获原世界和访问代际；另一世界的迟到结果不能覆盖当前显示。返回原世界时，迟到失败仍校对实时回滚，但不恢复旧访问的错误提示。不修改全局 History API。
5. 扩展产物的 `.js/.mjs/.cjs` 使用同一审计，后缀不区分大小写；HTML 脚本引用必须指向这些已审类型的本地文件。动态导入、远程执行、fixture 标记和内置版远程能力限制保持不变。
6. Worker 运行时和 Wrangler 渲染/部署检查共用纯路径校验。拒绝 URL 解析会改写的 pathname、网络路径及非法字符；合法百分号编码原样保留。唯一性检查包含省略配置的默认路由，错误不回显配置值。

检索现有活跃决定后，本篇补充[生命周期与资源复审](2026-10-22-audit-lifecycle-and-admission.md)、[有界读取](2026-09-29-bounded-io-and-lifecycle.md)及[取消交接与顺序](2026-10-22-audit-resource-and-ordering.md)，保留原证据。Key 验证依据替代[同页恢复决定](2026-09-22-captcha-recovery-and-manual-selection.md)中的 HEAD 方案，实际凭据提交驱动恢复的时序不变；没有需要吸收的 proposed 记录。

## Alternatives considered

- 发现命名控件后禁止整个表单：能够失败关闭，但会拒绝本来有效的同源表单；原生 getter 可以保留正常能力。
- 仅检查 `Content-Encoding` 后放宽模型长度：CORS 可能隐藏该头，且压缩结果可能比原文件更大；编码声明与解码正文必须独立约束。
- 继续 HEAD 并增加服务端身份响应头：需要 Worker、CORS 和客户端同时迁移；现有 quota 路由已能明确鉴权且不计次，无须新增协议字段。
- 切换世界后重建 App 或面板：会丢失节点与异步写入身份；同步世界和访问代际足够隔离结果。
- 只补 `.mjs` 后缀：HTML 仍可引用其他未审脚本类型；同时约束脚本入口类型才能关闭同类缺口。
- 自动规范化公开路径：会悄悄改变运维配置并可能合并路由；拒绝非规范值使碰撞在部署前可见。

## Consequences

产品版本、模型/WASM 身份、持久存储格式、扩展权限和发布授权不变，没有依赖升级。Key 验证现在依赖额度读取可用性；额度服务故障会阻止保存，即使 KV 中的 Key 有效。验证不访问 R2，也不证明模型可下载或推理成功。模型下载、缓存、确认和生产鉴权仍需各自证据。

非规范自定义路径会从隐式错路由变为明确配置拒绝；运维需提供已编码的规范 pathname。世界同步在下一次相关面板活动发生，不承诺拦截任意 `pushState` 的即时空闲刷新。

## Native verification

以下均使用原模块、本地 fixture 和隔离运行时，不使用生产 Key：

- Chromium 155.0.8059.79：命名 `action` 控件仍存在时，跨源表单拒绝、等待期间改址取消，同源恢复后只产生一次原生提交；提交事件被拦截，没有外发。
- 同一 Chromium：同一 PNG 的 identity、gzip、br 均成功；本地 canonical ORT 的三种表示均通过实际长度与 SHA-256。跨源小模型的编码头未被 CORS 暴露，gzip/br 编码长度大于原始长度仍成功。
- Key 验证只发送 quota GET；有效、禁用与耗尽额度成功，无效 Key 返回拒绝，没有模型 GET、HEAD 或确认请求。
- 真实 StatusPanel、HistoryStore 与 localStorage：切换到异世界后记录进入异世界，旧世界迟到失败不污染当前面板；返回主世界刷新原节点。
- 原生 Node：相同动态导入载荷的 `.js` 与 `.mjs` 均被产物审计拒绝。
- 真实 workerd：规范及百分号编码路径正常返回模型 OPTIONS；点段、编码点段和原始空格配置在路由前返回通用 500，不再串到额度端点。

## Repository verification

固定 mise 工具链下，完整检查链通过。首次 `pnpm check` 在新增路径校验的空值分支未覆盖时停止；补充显式空值/空白值拒绝回归，保留 Worker 语句、行和函数 100% 门槛。随后按失败或未完成阶段续跑，没有降低覆盖率或跳过用例。

集成中修正三处测试夹具问题：共享 TypeScript 白名单副本放在临时 `packages/shared`，通过 workspace 符号链接导入，避免 Node 拒绝剥离 `node_modules` 内类型；截断响应的多项断言共用同一次请求 Promise，不重复消费同一 Response；图片字节比较复用既有跨 realm 数值数组约定。Node smoke 的共享常量改走显式、可原生加载的 `shared/model` 子路径。没有放宽生产校验以适应测试。

| 验证类别                                          | 最终结果                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| 工作区 Vitest                                     | 1380 项通过，原覆盖率门槛通过                                          |
| 应用 Node 脚本                                    | 273 项通过；覆盖率链另行重复的 9 项产物用例不重复计数                  |
| 根级 Node                                         | 378 项通过，无 skip/todo                                               |
| 格式、lint、五工作区类型与构建                    | 通过                                                                   |
| 文档事实、链接、笔记、架构、危险调用与 Action pin | 通过                                                                   |
| 用户脚本 Chromium E2E                             | 10 项通过，含原生命名控件遮蔽与恢复回归                                |
| 扩展 content fixture                              | 自动/手动、单次提交、历史、fieldset、action、BFCache、JPX 连续三题通过 |
| remote 双浏览器 load-only                         | Chromium 155.0.8059.79、Firefox 153.0 通过；不代表真实鉴权             |
| canonical packaged 双浏览器                       | 实际 ZIP 各完成两次非随机推理，销毁/空闲后重建通过                     |

| 用户脚本未压缩 profile | 实际字节 | 预算字节 |
| ---------------------- | -------: | -------: |
| external               |   206721 |   262144 |
| bundled                |   289498 |  1048576 |

原 Worker 生成配置已按字节恢复；临时 driver、ZIP、证据目录及本次浏览器/HTTP 运行时已清理，默认 external 用户脚本和 remote 扩展产物保留。未执行生产 Key 鉴权、真实用户脚本管理器、最低 Chromium 116/Firefox 140、Firefox Android 142 或远程 CI/CodeQL；当前浏览器、fixture 和本地 canonical 推理不能替代这些证据。未提交、推送、发布或部署。

## 同日再次复审：工具链、鉴权与维护边界

本轮保留工作区已有 40 个修改文件和 2 个未跟踪文件，重新按七个所有权分片审阅三个应用、两个共用包、根脚本及两份 workflow 的一方源码、注释和测试。使用文件清单补齐 CodeGraph 漏索引的 model/build/shell；第三方压缩代码和 WASM 按供应链身份核对，不宣称逐行审计上游源码或证明模型准确率。

### 新确认问题与决定

1. 用户脚本仍把 `ModelDownloadQuotaExceededError` 当作旧 HEAD 验证成功，HTTP 429 会保存新 Key 并恢复 App。删除异常后保存的遗留分支；仅正常完成认证 quota JSON 验证才可提交。合法耗尽/禁用 JSON 继续有效，403、429、503 等失败保留旧 Key。
2. 扩展远程 Host 读取 Key 时漏传下载器已有取消信号；等待 IndexedDB 打开期间取消后仍会启动读取。下传原信号给现有秘密存储，不新增存储接口、重试或共享取消框架。
3. canonical 模型下载脚本仍将 HTTP 编码声明长度与 Fetch 解压后长度混用。编码声明使用独立开销预算，正文仍按 canonical 精确长度分配、读取和校验 SHA-256；不放宽模型实际容量。
4. 扩展动态导入审计的正则漏掉 `import` 与 `(` 之间的注释，并误拒绝字符串里的 `import(`。改用已有 TypeScript AST 识别真实动态导入，保留 `.js/.mjs/.cjs`、权限、CSP 与远程执行审计。
5. 文档链接与命令检查错误地接受不匹配或带尾随内容的关闭围栏，shell 标签前导空格也会漏检。沿用笔记检查已有的字符、长度和 info string 规则，不引入第二套 Markdown 依赖。
6. 旧根历史先完整过滤再截取 50 条，读取解析缓存时仍扫描全部项。改为收满前 50 条有效记录即停止，保留原顺序、逐条校验与只读兼容。模型完整性检查复用现有 `sha256Hex`，移除重复摘要函数及其额外中间数组；哈希复杂度不变。

### 测试与注释取舍

- Worker 两项“无效/未授权 Key”用例原先只传 query，未进入 Bearer 路径；修正输入并验证 KV 是否读取。删除重复 query-only 用例，`http-cors.test.ts` 的有效 query-only Key 诱饵回归继续保护“查询字符串永不授权”。
- 两项 localStorage 错误测试的 prototype spy 被公共 fixture 自有方法绕过。改为注入实际存储对象，预置非默认数据并确认异常分支确实执行。
- 删除 Node/pnpm 版本字面副本测试，不把旧字符串重新固定为新字符串；实际 mise 执行、冻结安装、文档漂移反例和 CI 缓存/锁文件安全检查保留。核心工具测试精简配置字面副本与重复错误文案断言，原配置关联、逐层 deadline、永久错误行为仍有覆盖。
- 修正 HEAD 注释：它保留未计次的真实/诱饵元数据访问，不再承担客户端 Key 验证。没有为减少行数删去取消、事务、手动答案、稀疏数据、完整性或既有安全缺陷回归。

### Node.js 安全补丁与依赖审计

全量 npm 图的 `pnpm audit --json` 返回 363 个依赖、零公告；`pnpm audit signatures --json` 验证 363 个签名，无缺失或无效项。八个 Python 哈希锁包、pip `26.2.0`、固定 ORT commit 及九个不同 Actions commit 经 [OSV batch API](https://google.github.io/osv.dev/post-v1-querybatch/) 查询，无记录。已安装 npm 许可元数据无 Unknown；这不等于法律审查或证明无未知漏洞。

npm 的零结果不覆盖 Node 内置组件。固定的 Node `24.15.0` 缺少官方 [六月](https://nodejs.org/en/blog/vulnerability/june-2026-security-releases)、[七月](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases)及[十月安全修复](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)，包含 TLS、DNS、HTTP/2 与 Brotli 的 High 级问题。原生 `tls.checkServerIdentity` 对 `a。b.example.com` 和 `DNS:*.example.com` 在旧版本错误接受；`24.22.1` 拒绝该输入，合法 `b.example.com` 仍接受。该对照证明一个具体 TLS 修复，不冒充逐项漏洞利用验证。

维护者明确选择立即采用 Node `24.22.1`，仅此次安全补丁例外七天等待；mise、根包最低版本和当前文档同步，安装器校验下载摘要，冻结安装成功。pnpm `12.11.2`、npm/Python 锁、产品版本、模型/Runtime 资产和发布门禁不变；[原测试工具链决定](2026-09-29-test-toolchain-security.md)的 npm 等待策略仍有效。

`pnpm outdated` 中的新版不等于漏洞，未作无关全量升级。已弃用的 `@cloudflare/vitest-pool-workers` 仍是维护风险；更名迁移涉及 Wrangler/Miniflare 与 Vitest 兼容验证，本轮不与已确认修复混合。

### 取舍与性能证据

保留异常成功分支会混淆“HTTP 拒绝”和“已认证的耗尽状态”；仅增加动态导入正则变体仍不能可靠区分代码、注释和字符串。采用现有认证响应、AST 与取消接口，比新增例外和框架更小。

Chromium `151.0.7922.34` 的相同旧根包含 10,000 条有效记录与 10,000 个 `null` 交错；首次及缓存后读取的数组项访问均由 20,000 次降至 100 次，两版都返回 `P0` 至 `P49` 且不改写存储。JSON 解析仍需处理完整旧根，不宣称整体时间或内存降低相同比例。模型下载/完整性 smoke 中，32 元素数组再 `.map()` 的额外分配由七次降至零；identity/gzip/br、损坏拒绝、取消和 reader 释放结果保持不变。不宣称 ONNX/WASM 推理速度提升。

### 再次复审验证结算

Node `24.22.1`、pnpm `12.11.2` 下完成全部检查链。首次 `pnpm check` 在新增测试使用项目当前 lib 未声明的 `Promise.withResolvers` 时停止；改用故意保持未决的依赖 Promise，继续验证取消不等待底层确认，不提升浏览器库目标。从失败的扩展类型检查续跑，其余工作区覆盖率和根级测试各执行一次。

| 验证                             | 结果                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------- |
| 格式、lint、五工作区类型与构建   | 通过                                                                              |
| 工作区 Vitest                    | 1385 项通过，覆盖率门槛不变                                                       |
| 应用 Node 脚本                   | 277 项通过；既有覆盖率链另执行的 9 项产物用例不重复计数                           |
| 根级 Node                        | 385 项通过，无 skip/todo                                                          |
| 文档、架构、危险调用、Action pin | 通过                                                                              |
| 用户脚本 Chromium E2E            | 10 项通过                                                                         |
| 扩展 content fixture             | 自动/手动、单次提交、历史、fieldset、action、BFCache、JPX 三题通过                |
| remote 双浏览器 load-only        | Chromium 155.0.8059.79、Firefox 153.5 通过，不代表鉴权                            |
| canonical packaged 双浏览器      | Chromium 155.0.8059.79、Firefox 153.5.0 的实际 ZIP 各两次非随机推理及会话重建通过 |
| Runtime glue/WASM                | 本地长度和 SHA-256 与采用清单一致                                                 |

所有分片原生 probe 均在集成后用新 Node 重新执行：429 零写入/零恢复；取消后两类远程 Host 操作零 Key 读取且零 fetch；压缩 canonical 下载成功而错长/错哈希拒绝；注释分隔的动态导入拒绝、惰性字符串通过；围栏错误不再隐藏链接/命令；Bearer 与 query 分离、KV 总期限、历史和摘要边界保持。

| 用户脚本未压缩 profile | 实际字节 | 预算字节 |
| ---------------------- | -------: | -------: |
| external               |   206668 |   262144 |
| bundled                |   289445 |  1048576 |

canonical 扩展和 bundled 用户脚本使用仓库外独立输出，不覆盖最终 remote/external 产物。Worker 原生成配置按字节恢复。未执行生产 Key 鉴权、真实用户脚本管理器、精确最低 Chromium 116/Firefox 140、Firefox Android 142、完整 ORT 重编或远程 CI/CodeQL；上述 fixture、当前桌面浏览器和本地 canonical 推理不能替代这些证据。未提交、推送、发布或部署。
