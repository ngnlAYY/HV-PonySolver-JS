# 2026-10-27 源码、文档与依赖审计

基线为 `2ce6a02`，开始时工作区干净。本次按模块审查第一方源码、注释、测试、维护文档、依赖清单和工作流；第三方 Runtime 保持原资产与许可证，历史决定/审计保留原证据日期。

## 范围与结果

| 模块               | 核对重点                                                      | 处理                                          |
| ------------------ | ------------------------------------------------------------- | --------------------------------------------- |
| shared             | 答案映射、模型/WASM 身份、Key 与回执规范化                    | 保留纯契约与显式 exports                      |
| browser-core       | 目标快照、手动答案、推理、字节读取、缓存事务、历史/面板       | 优化 RGBA 转换；修复声明长度错误回显          |
| userscript         | GM 敏感存储、Key 写入次序、Blob Worker、双 Runtime 构建       | 改进现有推理基准采样；保留平台适配            |
| extension          | Broker/Offscreen、Host、Key 数据库、设置镜像、packaged/remote | 精简 Broker 准入分支；修复内置资产 Fetch 取消 |
| model-worker       | KV 截止时间、R2 完整性、DO 预留/确认、HTTP/CORS               | 保留当前状态与协议；更新测试工具传递依赖      |
| scripts / CI       | 构建清理、归档、产物审计、文档漂移、发布门禁                  | 保留隔离与发布约束，运行对应检查              |
| docs / 注释 / 测试 | 权威入口、取消说明、依赖用途、重复测试结构                    | 更新手册与决定；修正取消即释放槽位的过时描述  |

实现与取舍见[决定](../decisions/implemented/bug-fix/2026-10-27-audit-preprocessing-and-cancellation.md)。无需改动的模块保留原实现，避免为减少行数引入新的状态所有者或绕开边界。

## 性能与精简

RGBA 预处理用固定 256 项 Float32 表取代每帧逐通道除法；写入前验证长度，不会静默写入过短的输出缓冲区。全部字节值、RGB 顺序、非零视图偏移及输出外围哨兵均有断言。

本机 Node.js 24.22.1，640×640 确定性 RGBA，先预热各 100 次，旧/新实现交替测量 9 批、每批 100 次：

| 实现 | 中位耗时     |
| ---- | ------------ |
| 基线 | 2.4578 ms/op |
| 本轮 | 2.2134 ms/op |

该次微基准减少约 9.9%，完整输出逐元素一致；这是预处理 CPU 测量，整题时间还包含解码、WASM 推理、网络和提交等待。现有 `benchmark:inference` 已加入预热与 7 批中位数，便于后续同环境比较。

Broker 将六种请求的上限、超时和提示放入穷尽策略表，所有类型复用计数增减与准入路径。清除 Key、验证、下载、查询仍各自计数，取消/断连保持槽位直至规定结算点。

测试精简保留的等价断言：

- 六组 letterbox 输入及期望坐标保持，改为 `it.each`。
- 下载与额度查询仍分别执行来源拒绝、端口饱和、响应交付；共享测试体补测实际全局饱和和容量释放，取代仅检查常量数字。
- 非十进制与超出安全整数的长度声明统一测试体，仍要求不读取正文并取消流；新增原始头值不回显断言。
- 内置资产保留正文/摘要取消回归，新增预取消和忽略取消的 Fetch 迟到成功/失败；摘要阶段测试不绑定监听器移除次数。

未降低 coverage 门槛、改变 include 或增加 skip/todo。

## 依赖审计

包含开发依赖的 npm 审计从 9 High、8 Moderate 降为全部 0；这是本次 registry 返回的已知公告结果。公告/major 重复计数并非 17 个独立漏洞。

| 依赖     | 原锁定版本 | 本轮版本 | 使用位置                  |
| -------- | ---------- | -------- | ------------------------- |
| undici 7 | 7.29.1     | 7.30.1   | Miniflare/Worker 测试工具 |
| undici 8 | 8.10.2     | 8.12.2   | jsdom                     |
| zod 4    | 4.4.3      | 4.6.6    | Cloudflare 测试集成       |

修复依据为 [undici 公告](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c)及 [Zod 公告](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)。undici 两版本发布于 10 月 15 日，zod 发布于 10 月 11 日，满足七天等待期；冻结安装通过现有供应链策略，无新增豁免。

根包删除 Vite 直接声明：源码无直接导入，Vitest 仍持有传递依赖，workspace override 继续统一版本。两处 Knip 配置没有对应工具/命令且忽略不存在的直接依赖，已删除。依赖图仍为 363 项，未将声明精简表述为传递包数量下降。

保留依赖的原因：ORT 是实际推理/类型与构建输入；esbuild 负责客户端产物；fflate 提供流式确定性 ZIP 与 ZIP 验证；jsdom/Playwright 覆盖模拟 DOM 与真实浏览器；Wrangler、Cloudflare pool/types 支撑 Worker 运行时；Vitest 的 v8/Istanbul provider 分别覆盖普通与 Worker 环境；TypeScript 7 CLI 与 TypeScript 6 API 兼容包用途不同。Cloudflare pool 的弃用迁移仍需单独验证，不在安全补丁中顺带替换。

Python 哈希锁的 flatbuffers 25.9.23、ml-dtypes 0.5.4、numpy 2.5.2、onnx 1.22.0、onnxruntime 1.27.0、packaging 26.3、protobuf 7.35.1、typing-extensions 4.16.0，以及两处 bootstrap 的 pip 26.2.0，逐版本查询 PyPI JSON 的 `vulnerabilities` 均为空；OSV 批量接口不可达，采用 PyPI 版本元数据复核。[Node 官方安全索引](https://nodejs.org/en/blog/vulnerability)当前列出 24.22.1 为最新 LTS，沿用已固定工具链。

## 验证记录

以下命令均使用 `mise exec --` 固定工具链。Worker 测试前在仓库外备份生成配置，渲染 test-kv/test-bucket；完整检查后已按字节恢复原配置。

| 验证                                        | 结果                                                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`            | 通过，供应链策略与等待期不变                                                                                                 |
| `pnpm audit --json` / `pnpm audit:high`     | 0 已知告警，包含开发依赖                                                                                                     |
| `pnpm check`                                | 通过；1,393 项 Vitest、根级 385 项 Node 测试，以及工作区 Node 测试、覆盖率、lint、类型、文档、安全/架构、包体和构建门禁      |
| `node scripts/ci/assert-pinned-actions.mjs` | 通过                                                                                                                         |
| 用户脚本 default / bundled 包体             | 分别 206925 / 156714 字节，通过各自预算；default 未压缩、bundled 压缩，不作两者大小对比                                      |
| `pnpm test:e2e:userscript`                  | Chromium 10 项通过                                                                                                           |
| extension content fixture                   | 通过自动/手动答题、单次提交、历史、禁用 fieldset、提交地址变化、BFCache 与 JPX 换轮                                          |
| remote load-only                            | Chromium 156.0.8078.47、Firefox 153.0 通过                                                                                   |
| packaged fixture                            | 两浏览器 ZIP 校验、真实 ORT fixture 推理与会话重建通过；Chromium 另覆盖 epoch、service worker 重启、Offscreen 空闲回收与重建 |
| packaged canonical                          | 使用现有固定模型构建，两浏览器均完成两次非随机推理及销毁后重建；模型 SHA-256/长度与 shared 清单一致                          |

系统 Firefox 首次 load-only 因 CLI 与 WebDriver 版本不一致停止；改用已安装的 Playwright Firefox 153.0 后通过，未放宽版本比较。格式、文档漂移/链接/笔记及文档回归在补齐本记录后再次校验。Geckodriver 按仓库脚本固定 0.37.1 与 SHA-256 验证，证据与临时工具保留在仓库外。最终本地扩展产物为 canonical packaged 模式，用户脚本产物为 bundled Runtime；产物和临时证据均未纳入 Git。

无生产 Key 下载、远程 CI/CodeQL、发布或部署；最低浏览器版本与 Firefox Android 仍需独立环境证据。
