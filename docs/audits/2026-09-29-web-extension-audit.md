# 2026-09-29 Web 与扩展全仓库审计

本记录对应结合 `modern-web-guidance`、`chrome-extensions` 的全仓库风险审计，包含同次工作区已有的 MV3 加固。方法为模块/调用链盘点、关键路径源码复核、故障注入与自动化门禁；不是逐行形式化验证，也不把静态门禁通过解释为不存在漏洞。

## 方法与覆盖

先读取项目契约、架构与两项 skill，执行 modern-web-guidance 的搜索并读取 performance/security 指南，再按项目边界取舍。浏览器流取消、异步存储、service worker 生命周期、单调时钟与 HTTP 压缩长度语义另对照 MDN 和 Chrome 官方资料。使用 CodeGraph 定位入口；索引未覆盖文件再直接读取。

| 范围                    | 重点核对                                                                                                         | 证据入口                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `packages/browser-core` | App/目标身份、手动答案、原生提交、Worker 取消/队列、流读取、模型缓存、历史与面板生命周期                         | `test/app`、`test/captcha`、`test/inference`、`test/model`、`test/persistence`、`test/status-panel`、`test/platform` |
| `apps/userscript`       | GM 敏感存储边界、Key 修复、Blob Worker、双 Runtime profile、实际资产校验                                         | `test/userscript`、`test/inference`、构建测试、Chromium E2E                                                          |
| `apps/extension`        | content/Broker/Host/Offscreen 分层、sender 准入、BFCache、普通设置镜像、Key 事务、remote/packaged 隔离、产物审计 | `test`、`scripts/build`、桌面双浏览器 smoke                                                                          |
| `apps/model-worker`     | Bearer/KV、R2 完整性、额度预检/预留/确认、错误响应与取消                                                         | `test/http-cors.test.ts`、`quota-http.test.ts`、`model-download-quota.test.ts`、`failure-timeout.test.ts`            |
| `packages/shared`       | 答案/令牌/模型/Runtime 纯契约与显式 exports                                                                      | shared 测试、资产校验、架构门禁                                                                                      |
| `scripts`、配置与 CI    | 架构方向、危险调用、文档归属、构建预算、固定工具链/Actions、发布门禁                                             | 根级 Node 测试、`pnpm check`、Actions SHA 校验；未触发远程 CI 或部署                                                 |

未重写第三方 ORT 压缩源码，没有升级依赖、改变模型身份、权限、发布版本或默认产品行为。算法仍在 Worker 本地执行，验证码与答案不发送到模型服务。

## 发现与修复

| 编号    | 风险与复现                                                                                 | 修复                                                                  | 回归                                                                            |
| ------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| IO-1    | 图片错误清理、R2 完整性/额度拒绝等待永不完成的取消；模型客户端已有 HTTP 错误被清理超时覆盖 | 发起取消但不等待，并处理同步抛错/异步拒绝；保持原错误和调用方取消语义 | 图片 HTTP/头失败、模型下载/查询/验证/确认、Worker 三条拒绝路径                  |
| IO-2    | 未知长度流保留任意数量空/小分块及其底层大缓冲；源复用缓冲时还会改变既有分块内容            | 有界自有缓冲按需增长、即时复制、跳过空分块；图片复用共享实现          | 复用分块、100000 个空/单字节分块、长度/超限/取消及已知长度单次分配              |
| LIFE-1  | 旧存储镜像销毁后仍可启动队列中的写入/删除；预先取消仍读快照                                | 实际调用前检查销毁；预取消初始化立即退出；已发起存储调用保持真实结算  | 排队 set/remove、首次微任务前销毁、晚到已启动写入、预取消                       |
| ASSET-1 | Runtime 长度头经 Number 转换接受空值、指数、十六进制等非规范值                             | 规范十进制、安全整数、上限校验；实际解压正文继续精确长度/hash 校验    | 畸形声明拒绝，合法压缩长度差异保留                                              |
| TIME-1  | 推理客户端初始化/推理用系统时钟差值，时钟回拨可产生负耗时                                  | 阶段耗时改用 performance.now；历史时刻与额度月份不变                  | 初始化与推理分别模拟系统时间回拨                                                |
| MV3-1   | 原 sender URL 回退与元数据检查不够严格；这是信任边界加固，不据此宣称存在可利用的外部入侵   | 要求实际 sender.url；校验可用 origin/frameId、HTTPS origin、URL 凭据  | Broker 来源矩阵和 Host 调用前拒绝                                               |
| MV3-2   | 原构建检查偏重字段子集/脚本标签，未拒绝若干能力扩张和 HTML 可执行形式                      | 完整关键清单比较、额外权限/外部连接/sandbox 拒绝、DOM 递归审计        | Chromium/Firefox × remote/packaged 负向清单，template/SVG/事件/URL 等 HTML 注入 |

IO-1 与 LIFE-1 属于可复现的挂起/旧生命周期副作用；IO-2 是资源与读取正确性问题；ASSET-1/TIME-1 是校验/显示一致性问题。此处未做外部攻击可利用性评级。修复依据分别见[有界 IO 与生命周期决定](../decisions/implemented/bug-fix/2026-09-29-bounded-io-and-lifecycle.md)及[MV3 边界决定](../decisions/implemented/bug-fix/2026-09-29-extension-mv3-boundaries.md)。

## Skill 适配取舍

- 采用：本地 Worker 分离重计算、安全 DOM、限权/限域、消息来源和 schema 校验、资源/队列有界、生命周期清理、负向测试和包体门禁。
- 不机械采用：全局变量禁令、所有 `.then()` 改写、把短时请求超时替换成 alarms。这里的锁、epoch、请求表和串行尾链属于可丢弃的当前生命周期，不作为持久业务真相。
- 不加入：额外 tabs/activeTab 权限、sandbox/blob/srcdoc 扩展执行入口、远程可执行代码、新框架或动态导入。项目 CSP、内置模式和最低支持版本优先。
- 不把页面隐藏解释为停止答题，不为小型状态面板加入未经测量的布局/动画优化。缓冲改动证明的是保留对象/字节边界与正确性，未声称实测 INP、模型速度或内存峰值降低百分比。

## 验证记录

已先运行并观察新增核心、镜像、Runtime、Worker 与计时回归失败，再实施修复。下列检查在本轮共享核心修改后重新执行，不以此前 MV3 单独验证替代。

| 验证                      | 结果与范围                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `mise exec -- pnpm check` | 通过格式、lint、类型、全部工作区与根级测试、文档、架构、危险调用、扩展打包、默认包体、覆盖率和全仓库构建               |
| 工作区 Vitest             | shared 15、Model Worker 128、browser-core 507、userscript 234、extension 296 项通过；未把覆盖率重跑重复计数            |
| Node 测试                 | Worker 脚本 56、用户脚本构建 28、扩展脚本 174、根级 315 项通过                                                         |
| 用户脚本 Chromium E2E     | 3 项通过：本地验证码、并发历史、外置 Worker 原生 JSEP MJS 导入；不是真实 GM 管理器/生产模型验收                        |
| Chromium content fixture  | 自动/手动、单次检测/提交、历史、fieldset 恢复、action 变化、排除路由及 BFCache 恢复通过                                |
| 远程扩展 load-only        | Chromium 154.0.8037.57、Firefox 153.0 通过加载和设置页检查；无受保护模型请求                                           |
| 内置 fixture 双浏览器     | Chromium 154.0.8037.57 通过 oracle、后台重启/Offscreen 接管、旧 epoch 取消和空闲重建；Firefox 153.0 通过两次推理及重建 |
| 用户脚本双 profile 预算   | 未压缩 external 203390 B / 262144 B；未压缩 bundled 285047 B / 1048576 B，均通过                                       |
| Actions 固定与差异        | `assert-pinned-actions.mjs`、`git diff --check` 通过；未运行远程 CI                                                    |

Worker 测试配置仅使用测试绑定，原生成配置在检查后逐字节恢复。浏览器测试使用仓库固定的 geckodriver 安装工具；未输出或使用生产 Key。验证结束重新构建默认 external 用户脚本和 remote 扩展，避免把 fixture 产物留作默认可加载包。无 commit、push、发布或部署。

## 依赖告警：初次记录

后续状态：用户要求修复后，同日已单独实施依赖安全补丁并重新验证，见[补丁复核记录](2026-09-29-dependency-security-remediation.md)。本节保留初次源码审计时的版本、告警和处置边界，不表示这些告警当前仍未修复。

2026-09-29 的 `mise exec -- pnpm audit:high` 退出 0，但报告 **4 项 moderate**；这不等于零漏洞。完整 moderate 审计退出 1。`pnpm why -r undici` 显示两条工具链分支；`pnpm audit --prod --audit-level moderate` 报告未发现已知漏洞，仅代表按 package manifest 分类的生产依赖图，不代替浏览器产物审计。

| 上游公告              | 当前解析版本与范围                                                                                                                            | 上游修复版本                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `GHSA-82fw-gwwq-j7x9` | vitest / @vitest/mocker 4.1.10，两项报告；开发服务器 redirect mock 越界读取，存在服务可达性及插件入口前提，不能据此断言本项目可被远程直接利用 | 4.1.11；需同步 coverage 插件与 Cloudflare 测试集成 |
| `GHSA-3wwx-pv8p-q78v` | undici 8.10.0（jsdom）与 7.29.0（miniflare）各一项；恶意 WebSocket 对端触发解压错误可导致 Node 进程退出                                       | 对应分支 8.10.2 / 7.29.1                           |

公告核对来源：`https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9`、`https://github.com/nodejs/undici/security/advisories/GHSA-3wwx-pv8p-q78v`。这两组告警保留为后续测试工具链安全补丁事项：本轮保持包清单/锁文件不变，不用全量依赖升级混入源码修复，也不通过降低门槛或忽略 advisory 消除报告。补丁需分别验证 Vitest/coverage、Cloudflare workerd 与浏览器测试，不宜把不同 major 的 undici 强制统一。

## 未验证与保留边界

- 未使用生产 Key，未做受保护远程模型鉴权/真实模型识别；fixture 模型不证明 canonical 模型准确率或生产额度。
- 未运行 Chromium 116、Firefox Desktop 140 最低版本及 Firefox Android 142；当前桌面浏览器通过不能替代这些证据。
- 未验证所有用户脚本管理器、Safari 或其他移动环境；未运行远程 CodeQL、GitHub Actions、发布或部署。
- 依赖取消仍是尽力清理，不能撤销已提交 IndexedDB/storage.local 或服务端已确认额度；外部流若不合作，底层释放时刻不受本地保证。
- 本轮不是浏览器完整污点分析、上游 ORT/WASM 二进制审计或持续性能基准。后续重点仍是受保护 canonical/最低版本/Android 证据与真实页面测量，而非为套用指南而扩大产品能力。
