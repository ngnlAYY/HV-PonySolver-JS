# Agent Note: 取消收尾、静态校验与 CI 恢复

Status: implemented

## Problem

本轮重新审阅三个应用、两个共用包、根工具脚本、测试配置、两份 workflow 及所属文档。CodeGraph 定位后，以 LSP 和实际文件补齐未索引的 model/build 目录；审计是调用链与边界复核，不是形式证明或第三方 ORT 二进制审计。

故障注入确认以下缺口：

- 图片 fetch 和 R2 在超时后迟到返回，正文无人消费且未取消；缓存超时留下取消监听器。
- 用户脚本只在 fetch 适配器组合取消信号，未决 GM 凭据读取与摘要等待不能立即取消；额外流包装重复核心职责。
- 控件实际 form 归属未进入目标身份；扩展普通设置在首写未决时丢失改回原值的提交。
- canonical 下载器保留可变分块引用；发布证据缺失文件数仍被接受；HTML 审计漏过 data/VBScript URL。
- 模型与 Runtime 清单提取可把静态前缀当成实际值；源码扩展名、静态导入和全局危险调用存在扫描缺口。
- Worker 错误名称、部署探测异常和笔记 Git 失败可能泄露输入；Wrangler main 路径中的替换元字符会展开。
- 笔记必需标题可藏在 tilde 围栏内；ORT 接受额外参数；文档事实与命令检查重复读取相同文件。

[Actions 运行 39746492375](https://github.com/ngnlAYY/HV-PonySolver-JS/actions/runs/39746492375) 在 `Security audit` 和 CodeQL 上传失败。前者是 Vite `8.2.1` 受 [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) 影响；后者是个人私有仓库没有可用 Code Scanning，不是 TypeScript 编译失败。

## Decision

1. 保留底层操作身份，对迟到正文做尽力取消，不等待可能挂起的清理。缓存 deadline 自身参与同一次 abort race，超时后释放所有监听器，不重复取消。
2. 用户脚本直接把调用方信号交给核心下载器，只注入 GM Key。删除多余信号合并、Response 与 ReadableStream 转发，保留核心统一期限和错误分类。
3. 目标快照记录实际 `.form`，观察 `form` 属性失联与恢复。等价显式关联不重启，过期轮次仍不能点击或提交。
4. 普通设置 dirty 同时比较已提交与在途值；后续回退提交和首写失败后的重复提交都保留。只有实际成功推进 baseline。
5. canonical 下载按精确长度即时复制到自有缓冲；桌面证据要求正安全整数 `tree.fileCount`。HTML URL 统一规范化后拒绝 javascript/data/vbscript，不靠 CSP 或 CodeQL 抑制隐藏审计缺口。
6. 清单使用现有 TypeScript AST 检查完整 initializer、唯一直接属性及静态值，不执行源码。扫描覆盖全部项目 JS/TS 扩展名、静态模板导入、require/import-equals、全局和静态 computed 危险调用；CLI 缺受保护目录失败关闭。
7. 错误名称使用固定白名单；配置/网络/Git 失败不传播敏感输入或底层 cause。main 路径用 replacement callback 且只替换当前行，保留 LF/CRLF 与相邻空行。
8. 笔记按字符和长度匹配 backtick/tilde fence；ORT `--install` 只接受单个参数。文档读取缓存局限于一次调用，后续调用重新读盘；工具注释同步真实 Node 入口。
9. 根 Vite 声明与 override 固定到最小兼容补丁 `8.2.4`，重新生成锁文件。用户明确选择恢复公开仓库，保留 CodeQL category、上传与发布门禁，不替换或跳过安全检查。

检索现有非归档决定后，本篇补充[生命周期与路径边界](2026-10-15-audit-lifecycle-and-path-boundaries.md)、[有界 IO](2026-09-29-bounded-io-and-lifecycle.md)、[MV3 边界](2026-09-29-extension-mv3-boundaries.md)和[测试工具链补丁](2026-09-29-test-toolchain-security.md)，保留原验证日期和决定。没有需吸收的同主题 proposed 记录。

## Alternatives considered

- 仅丢弃迟到结果：调用方能退出，但正文和监听器仍被保留。清理必须跟随实际资源身份。
- 把在途保存当作已提交 baseline：首写失败时会丢掉同值重试。两种状态不能合并。
- 继续扩充清单正则：难以可靠判断完整 initializer、类型包装与覆盖属性。复用已安装 AST parser，无需新依赖或运行源码。
- 降低审计阈值、关闭 CodeQL 上传或自动改变仓库可见性：会隐藏失败或改变隐私边界。先取得可见性授权，再验证真实上传。
- 立即升级 Vitest `4.1.12` 并新增等待期例外：可消除剩余两个 Moderate，但版本于 2026-10-15 14:51 UTC 发布，审计时尚未满七天。用户选择保留等待期；不升级 Vitest/coverage、不放宽供应链策略。

## Consequences

不改变模型/WASM 身份、产品版本、权限、额度协议、最低浏览器版本或发布输入。资源收益来自删除重复包装、即时复制、取消废弃流和释放监听器，不宣称实测推理速度、内存峰值或百分比提升。

依赖 High 门禁通过，但仍保留开发依赖的 [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) 与 [GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp)。等待期结束后升级须同步 Vitest 与 coverage，并复核 Cloudflare 测试集成。

恢复公开后，旧提交 `ca12aafa875b85f7f3ab57b82e88bbd2a6374b0a` 的 [CodeQL 重跑](https://github.com/ngnlAYY/HV-PonySolver-JS/actions/runs/39746492375/job/119724796945)成功，分析 `2003276618` 无执行错误。其 [告警 #6](https://github.com/ngnlAYY/HV-PonySolver-JS/security/code-scanning/6) 对应本轮 HTML 审计修复；此轮重跑仅验证旧提交，修复是否结算须查看修复提交对应的新分析，不能以旧运行宣称整个远程 CI 已通过。

实际 Chromium smoke 已验证控件归属变更即时取消、恢复后一次提交与历史记录，以及普通设置在途回退后的两次有序写入。原生流 smoke 验证复用分块读取正确、迟到图片/R2 正文被取消；CLI smoke 验证恶意 URL 和缺失发布文件数被拒绝、路径字面保留及额外 ORT 参数返回 Usage。它们不证明生产鉴权、线上 R2 行为、最低版本或 Android 真机验收。

## Verification

本地使用固定 mise 工具链，Vitest 限制最多两个 worker。初次检查在错误脱敏 lint 和文档 fixture 读取接口失败；修正后从失败阶段续跑，保留既有 fixture 注入接口，不重复已经通过的工作区覆盖率。

| 检查                                             | 结果                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| 格式、lint、五工作区类型与构建                   | 通过                                                                 |
| 工作区 Vitest / Node 测试                        | 1,171 / 257 项通过，覆盖率门槛不变                                   |
| 根级 Node 测试                                   | 364 项通过，无 skip/todo                                             |
| 文档事实、链接、笔记、架构、危险调用、Action pin | 通过                                                                 |
| 用户脚本 Chromium E2E                            | 9 项通过                                                             |
| 用户脚本未压缩 external / bundled                | 206,520 B / 288,177 B，分别低于 256 KiB / 1 MiB                      |
| Runtime glue 与本地 WASM                         | 长度和 SHA-256 均通过                                                |
| 扩展 content fixture                             | 自动/手动、单次提交、历史、fieldset、action、BFCache 与 JPX 恢复通过 |
| 远程扩展 load-only                               | Chromium 155.0.8059.79、Firefox 153.0 通过                           |
| 内置 fixture 与本地 canonical                    | 同两浏览器通过真实 ZIP 加载、非随机推理与会话重建                    |
| 冻结安装与 High 审计                             | 通过；两个 Moderate 按用户选择保留等待期                             |

Worker 测试只用占位绑定，原生成配置已按字节恢复。临时 smoke 源不留在仓库，默认 external 用户脚本和 remote 扩展重新构建。未在本地运行最低 Chromium 116/Firefox 140、Android 142、生产 Key 鉴权或部署；远程结果只按对应提交的实际运行另行报告。
