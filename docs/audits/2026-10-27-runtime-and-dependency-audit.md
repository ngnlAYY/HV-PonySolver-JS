# 2026-10-27 运行时交付、最小构建依赖与维护性复核

基线 `bd1e1a3`，开始时工作区干净，main 比 origin/main 领先四个提交。七个分区并行审阅，主会话负责数值路径、shared、当前手册、集成及实际验证；审阅开始于 10 月 27 日，完整验证于 10 月 28 日完成。实现取舍见[本轮决定](../decisions/implemented/bug-fix/2026-10-27-runtime-delivery-and-minimal-ort-build.md)。

## 审阅范围

完整读取 148 份第一方运行时源码及相关注释：browser-core 51、shared 7、用户脚本 27、扩展 52、Model Worker 11。各运行时分区完整审阅相关测试/helpers；根与扩展生产工具、两份 workflow 逐文件审阅，工具测试按真实行为和负例核对，没有声称逐行穷尽全部文档关键词测试。主会话读取 20 份当前导航、使用、架构、参考与开发手册，并核对 vendor README。

第三方压缩 Runtime 核对字节身份、完整许可与实际运行；没有逐行重审上游压缩实现，也未重新编译 C++/WASM 或重新生成模型。历史审计保留原日期证据。

## 修复与精简

| 范围                 | 当前修改与证据                                                                                                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Solver 重试阶段交付  | 图片/推理内部成功后、调用方续体前取消或导航，旧轮次仍更新状态或读取设置。续体现在再次复核当前性；原生 Chromium 复现并验证四种场景及新轮次恢复。                                                                                                      |
| 额度、Key 与缓存下载 | quota/probe 复用已有 deadline 作最终取消检查；缓存下载复核关闭代次，覆盖显式 close、versionchange 和数据库异常关闭。不会撤销已提交副作用。                                                                                                           |
| 扩展 Host            | 最终模型响应前复核意图，公开方法直接分派返回处理 Promise。原未决交付窗口被拒绝或消除；已经交付的成功不撤回。                                                                                                                                         |
| 设置镜像             | 快照已结算但镜像尚未交付时取消，现在销毁监听并拒绝，不返回停止接收 storage 变更的实例。                                                                                                                                                              |
| YOLO 结果组装        | 一次构造只读候选对象，检测列表使用独立前缀数组；阈值、稳定同分顺序、逐列验证和结果值不变。                                                                                                                                                           |
| 产物校验             | 单次整树扫描复用两份 JSON 字节和模型摘要；不重复读取、哈希完整模型。每次调用仍重新读盘并拒绝后续篡改。                                                                                                                                               |
| E2E 证据生成         | 稀疏 observations 不再生成 `passed:true`。发布端原有 attestation 本来会拒绝缺失结果，本轮未证实发布门禁可绕过。                                                                                                                                      |
| 危险调用门禁         | 补齐 `<T>` 类型断言解包，拒绝由断言包裹的 Function/importScripts/innerHTML；原有 as、computed 和 CLI 边界保留。                                                                                                                                      |
| 闲置代码与测试       | 删除九个用户脚本设置 wrapper、两项 cache helper 重导出和 core 无消费者历史条数清除接口；移除五项 shared 常量副本、一项弱排序、两项 shell 源码文字断言及一项闲置 getter 测试。保留 GM、真实面板、独立排序 oracle、文件/ZIP、HTTP/DO、安全和并发回归。 |
| Worker 文档          | Vitest 实际已自动生成隔离配置，build/typecheck 只检查类型。删除普通检查前覆盖根 Wrangler 配置的过时步骤；原生探针确认继承的部署值被忽略、根配置字节未变。Worker 运行时无新增源码修改。                                                               |

所有公开符号清理先核对引用和调用者；没有新增兼容别名、skip/todo 或降低 coverage 配置。测试归属及替代覆盖见[测试精简记录](../decisions/implemented/testing/2026-10-14-test-suite-ownership.md#2026-10-27-资产断言与排序覆盖复核)。

## 性能证据及边界

数值探针使用当前 Node 24.22.1，预热后交替运行两版，九批、每批一万次，报告每次解析耗时中位数。24 组输入覆盖 1/15/16/17/300/100000 行、递增/递减/同分/混合顺序，逐值匹配修改前实现与独立稳定全排序 oracle；六列非有限值负例仍拒绝。

| 指标                          |    修改前 |    修改后 |
| ----------------------------- | --------: | --------: |
| 16 行解析，ms/op              | 0.0021006 | 0.0018849 |
| 300 行解析，ms/op             | 0.0143737 | 0.0127900 |
| 16 候选全部命中时的检测对象数 |        32 |        16 |
| 四文件产物树读取次数          |         7 |         4 |
| 同次产物树读取字节            |  19829246 |   9914623 |

产物读量对比使用 9914448 字节合成模型，前后均拒绝下一次调用前的篡改。上述测量只证明解析及文件验证的局部收益，不代表整题推理、浏览器峰值内存或真实验证码准确率改善。

## 依赖审计与构建收窄

根和五个工作区的直接依赖逐项按实际 import、CLI/API 与构建消费者核对。保留用途如下：

| 依赖组                                               | 实际消费者                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| TypeScript 原生 CLI / TypeScript 6 API / @types/node | 五工作区类型检查；ESLint、源码/清单/产物 AST；Node 工具类型 |
| Vitest、两种 coverage provider                       | 工作区行为测试；普通 Node/浏览器逻辑与 workerd 覆盖率       |
| ESLint、@eslint/js、typescript-eslint、Prettier      | 第一方源码与文档门禁                                        |
| esbuild、Terser                                      | 应用打包；最小 ORT glue 打包与 Emscripten 两轮压缩          |
| fflate                                               | 实际扩展 ZIP 创建与验证                                     |
| onnxruntime-web                                      | Runtime 类型契约及固定外置资产来源                          |
| Playwright、jsdom                                    | 原生浏览器 E2E 与平台/DOM 回归                              |
| Cloudflare pool、workers-types、Wrangler             | workerd 测试、Worker 类型、开发/配置/部署工具               |

删除根包无根命令/API 消费者的 `@typescript/native`，保留五工作区直接声明。根新增 esbuild `0.28.2` 与 Terser `5.47.1` 作为真实构建工具；原有 363 个唯一包版本不变，新增六个 Terser 闭包成员，最终为 369。冻结安装及七天等待/trust policy 校验成功；最终含开发依赖的 `pnpm audit --json` 所有严重度均为 0，369 项 registry integrity/签名核对全部通过。

本轮额外发现 ORT 构建会安装固定上游 `js/`、`js/common/`、`js/web/` 的三份 npm 锁，根 pnpm audit/override 不覆盖。其 679 个唯一包版本中，19 个命中 49 条不同公告（29 High、14 Moderate、6 Low）。来源包括 [body-parser](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828)、[extract-zip](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3)、[serialize-javascript](https://github.com/advisories/GHSA-m5mm-p8h7-m29v) 等；部分无兼容修复或新版本尚未满七天。此处是构建工具暴露面，不证明已采用 vendor 可被利用。

新构建器移除三套 npm 安装/prepare 和上游 build.ts 字符串补丁，直接打包固定 web/common 源码。版本源码本就在固定 Git 树中，不依赖历史 prepare 生成物。最终验证使用从准确 commit 导出的干净源码；已有缓存 checkout 不干净，予以保留，不用于固定源码验收。只复用已有 Emscripten 模块/WASM，不做 C++ 全量编译。

真实 CLI 使用干净固定源码成功生成 56839 字节 glue，SHA-256 为 `7ffa604bdabbeec86645cf0575b4314e64cc88726d3bb208c570be22f91956de`；source map 含 34 份源码，无 node_modules 输入。构建与 shell 回归 11 项通过。最初的实际执行暴露了原型遗漏的 Node require 和动态导入；最终实现保留三个精确 Node fallback，并在固定源码阶段主动禁用外部 Runtime module override，其他导入继续拒绝。

新 glue 在原生 Chromium 156 中配合现有 WASM 与实际核心 Worker 完成八次推理：fixture/canonical 各两个会话、每会话两次。fixture 始终匹配 TS/0.95；canonical 使用透明合成图，只证明执行链路，不证明准确率。新字节尚未替换 vendor；后续采用须同步摘要及扩展旧动态导入替换约定，见[资产维护](../onnx-runtime.md#精简运行时供应链)。

Python 哈希锁八项及 bootstrap pip `26.2.0` 的 PyPI/OSV 查询为空；固定 ORT commit 和 Actions 引用的 OSV 查询同样无返回公告。Node 固定 `24.22.1`，另核对[官方安全公告](https://nodejs.org/en/blog/vulnerability)和[对应发布](https://nodejs.org/en/blog/release/v24.22.1)。这些是已知公告接口与完整性结果，不证明不存在未知漏洞；未执行生产下载或重新安装 Python 工具链。

## 当前执行证据

已通过核心四文件 198 项、扩展两文件 47 项、工具两文件 35 项定向回归。原生 Node 探针通过 quota/probe 取消、缓存关闭、Host Promise 结算边界、镜像监听清理、稀疏证据拒绝、危险调用识别和产物后续篡改拒绝。

原生 Chromium 的四种 Solver 失效场景均无旧状态、旧设置读取、提交或历史写入，后续轮次正常完成；解析结果与 oracle 一致，页面无脚本错误。探针和结果位于仓库外 `/tmp/hv-source-audit-7QSTV12J` 及各分区审计临时目录。

用户脚本 Chromium E2E 10 项通过，包括 external Blob Worker/JSEP、GM 未决读取取消、body 挂载及并发历史。扩展 content fixture 通过自动/手动、单次推理/提交、历史、fieldset/action、BFCache 和 JPX 连续三轮。

完整检查执行一次，未先运行 `check:quick` 重复工作区测试：

```bash
PNPM_CONFIG_WORKSPACE_CONCURRENCY=1 taskset -c 0-2 mise exec -- pnpm check
```

1421 项 Vitest、387 项根级 Node 测试及全部包内 Node/覆盖率通过，格式、lint、类型、文档、架构、危险调用、扩展产物审计和构建全部通过。Actions 固定 SHA/digest 与凭据门禁另行通过，vendor README 亦单独通过格式检查。这里的本机资源设置不改仓库并发或超时配置。

| 最终产物验证       | 实际结果                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| 用户脚本双 profile | default 未压缩 207126 字节；bundled 压缩 156866 字节，各自预算通过                                |
| remote load-only   | Chromium 156.0.8078.47、Firefox 153.0 加载与设置通过                                              |
| packaged fixture   | 两浏览器真实 ORT 与确定性 oracle 通过；Chromium 另覆盖后台重启、旧 epoch 取消、Offscreen 空闲重建 |
| packaged canonical | 两浏览器各两次成功非随机推理及会话重建；复用本地固定模型，无生产模型请求                          |

四份 schema 2 证据均为 passed，绑定实际 ZIP、模型、树哈希和正整数 fileCount；Firefox 核对 geckodriver 0.37.1。产物与证据保存在 `/tmp/hv-source-audit-7QSTV12J`，仓库 dist 保留 remote 扩展与 bundled 用户脚本；不提交生成物。根 Wrangler 配置未手动覆盖，原生浏览器临时标签和本轮本地 fixture 服务已关闭。

生产 Key 鉴权、远程 CI/CodeQL、精确最低版本和 Firefox Android 不属于这些离线证据。未提交、推送、发布或部署。
