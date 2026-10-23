# Agent Note: 生命周期、清除准入与响应资源复审

Status: implemented

## Problem

从干净工作树重新分区审阅三个应用、两个共用包、根工具脚本、扩展构建工具、两份 workflow、共享测试支持与维护文档。CodeGraph 定位后补读未索引的 model/build 文件，导出变更核对引用。第三方 ORT 源码、模型准确率、线上配置和远程安全告警不属于本地源码证据。

故障注入确认：

- 验证码容器外同 ID 节点改变显式 form 关联时，App 漏掉准备取消与失败恢复。
- 用户脚本终止 pagehide 后仍保留 DOMContentLoaded 回调，迟到就绪重新创建面板和菜单。
- Broker 已独立限制清除 Key，但 Chromium Offscreen 仍把清除与普通模型操作放入同一个池；两个未决操作会挡住清除抢占。
- structured clone 保留稀疏数组，推理结果的 Array.every() 校验跳过空洞，Worker bridge 接受不完整结果。
- 内部额度调用直接 response.json()，没有正文大小上限，失败、超时及迟到响应未完整清理。部署探测只检查响应头，却留下意外正文。
- Bearer 正则事实提取只读取字面前缀，正则后接逻辑表达式时仍报告旧鉴权契约。
- Chromium smoke 在清单预检、构建或启动失败时留下自建目录；benchmark 在版本拒绝后留下已启动浏览器。
- YOLO 候选与检测列表重复维护相同 top-N 排名；文档链接检查重复读取共享目标与源文档。

## Decision

1. App 在普通相关性检查未命中时，仅复核已跟踪控件的实际 form 所有者，不做无条件全页扫描；脱离页面的旧目标不触发补扫。
2. 用户脚本入口在非 persisted pagehide 移除待执行的就绪回调和自身监听，再销毁 App。BFCache 语义不变。
3. Offscreen 独立保留两个 clear-key 槽位；验证、下载和额度查询继续共用两个普通槽位。取消不提前释放清除容量，Host 结算后才允许替代请求。
4. 推理列表逐项校验，空洞走原有致命响应恢复。YOLO 只维护一次有界排序，阈值检测从原始置信度前缀生成；舍入、同分顺序、最高分兜底和所有行的完整校验不变。
5. Worker 内部额度 JSON 限制为 16 KiB 实际字节，增量 UTF-8 解码，复用原五秒依赖期限。取消跟随当前 Response/reader 所有权，清理不阻塞失败，解析错误不带正文。不跨层导入 browser-core。
6. 部署探测取消意外及迟到正文，不读取正文，不改变请求期限、重试预算或原契约诊断。
7. 正则事实复用完整 initializer 边界校验，保留纯类型后缀，拒绝运行时后缀。Markdown 正文与标题缓存只活到本次链接检查，下一次重新读取。
8. 清单预检通过后才创建 remote smoke profile；content smoke 的 profile 归属单一临时根，setup/close 失败也清理。benchmark 在会话所有权交给调用方前拒绝浏览器时主动关闭，保留原版本错误。
9. 文档说明 load-only 不证明 WASM 初始化，默认 Runtime 校验只验证精简 glue，WASM 需显式指定文件；重复验证命令改为权威手册链接。注释保留取消、所有权、原始阈值及安全提取的原因。

检索现有活跃决定后，本篇补充[取消交接与有界读取](2026-10-22-audit-resource-and-ordering.md)、[生命周期与路径](2026-10-15-audit-lifecycle-and-path-boundaries.md)及[静态校验复审](2026-10-22-audit-cancellation-and-ci.md)，不翻转原理由，不刷新历史验证数字；无须吸收的同主题 proposed 记录。

## Alternatives considered

- 对所有 DOM mutation 扫描页面：覆盖归属变化，但增加无关扫描；只比较已知控件所有者即可发现缺口。
- 清除操作绕过所有限额：能够抢占，却重新引入无界请求；独立有界池同时满足两项约束。
- 仅取消调用方等待：HTTP 失败更快，但流与浏览器资源仍无人回收；清理跟随实际所有者。
- 将浏览器字节读取器迁入 shared：减少少量重复代码，却把运行时 IO 引入纯契约包；本轮保持 Worker 边界。
- 只验证排名靠前的 YOLO 行，或用舍入后的置信度判断阈值：更省工作，但会漏掉异常数据或改变临界答案；保留全量验证与原始值。
- 永久缓存 Markdown：后续检查更快，但漏掉调用之间的文件修改；缓存限定单次调用。
- 只依赖进程退出清理 smoke：无法保护同进程调用与失败诊断，临时目录也不会随进程退出自动删除。

## Consequences

不改变产品版本、模型/WASM 身份、权限、支持浏览器、持久数据格式、公开 HTTP 状态或发布门禁。没有依赖升级，没有降低测试或覆盖率门槛。

收益是删除重复排序/读取、释放废弃正文与浏览器、及时终止旧页面工作。不会把解析器局部基准当作整体推理、浏览器内存峰值或识别准确率提升。16 KiB 是内部依赖防御上限，不改变额度协议；底层取消仍只尽力发起。

## Runtime evidence

所有探针使用本地 fixture，无生产 Key 或模型服务请求：

- Node 原生流：超限额度 JSON 从接受改为拒绝；失败、挂起、迟到正文各取消一次并释放 reader 锁。恰好 16 KiB 的分块 UTF-8 JSON 接受，畸形 JSON 不泄露正文。HTTP 预检拒绝超限响应，返回 503、Retry-After: 5，R2 读取为零。此独立探针使用 cloudflare:workers 最小加载替身，不冒充 workerd。
- Node 原生 fetch + loopback：两次部署契约失败后的未关闭响应从两个变为零。
- Chromium 155.0.8059.79：真实 Worker structured clone 经实际 bridge 拒绝稀疏结果，fatal=true，失败回调一次；原始阈值边界仍只选择阈值以上一项。
- 同一 Chromium：实际用户脚本入口在终止 pagehide 后收到就绪事件，面板、菜单、网络请求均为零；persisted 离开保留一个面板，随后终止离开移除它。
- Chromium source harness：三类普通模型操作饱和后均允许 clear-key，旧意图失败且只有清除提交；两个清除槽位满时，取消尚未结算的请求不开放第三个槽位。传输与模型依赖为 fixture，不替代安装后扩展消息验证。
- Bun/jsdom 实际 App/Solver/Submitter：外部 form 归属恢复后 prepare/detect 各两次、提交一次；保留人工答案与成功历史，body 替换复用原面板，销毁后不复活。
- 原生 Chromium 复验同一 form 恢复路径：归属失效时 prepare=1、detect=1、submit=0；外部节点改名后变为 2、2、1，最终选择为自动项 0 与原手动项 4。
- Node CLI：缺清单、构建失败与启动失败不留项目自建目录；实际 Chromium 被最低版本拒绝后不再连接。
- 2,000 份确定性生成张量在优化前后均匹配独立全排序参考。二十篇文档引用同一目标时，读取从 41 次降至 21 次；下一次调用编辑标题后仍逐篇报告二十处失效引用。

解析器单独 Node 基准取七批中位数，输入按置信度升序；并非浏览器/WASM 端到端测量：

|   行数 | 修改前每次毫秒 | 修改后每次毫秒 |
| -----: | -------------: | -------------: |
|    300 |       0.107983 |       0.057142 |
| 100000 |      33.498178 |      19.138648 |

## Repository verification

使用固定 mise 工具链，Vitest 每工作区最多两个 worker。完整 `pnpm check` 首次停在新增 Node 回归的两个 `no-undef`；按既有约定改用 `globalThis.Response/ReadableStream` 后，从 lint 阶段续跑剩余完整检查链。工作区覆盖率和根级测试没有重复执行，未修改覆盖率门槛。

| 检查                                             | 本次结果                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 格式、lint、五工作区类型与构建                   | 通过                                                                               |
| 工作区 Vitest                                    | 1243 项通过，覆盖率门槛通过                                                        |
| 工作区 Node                                      | 262 项通过；既有脚本另执行 9 项产物覆盖率检查                                      |
| 根级 Node                                        | 379 项通过，无 skip/todo                                                           |
| 文档事实、链接、笔记、架构、危险调用、Action pin | 通过                                                                               |
| 用户脚本 Chromium E2E                            | 9 项通过，含 external Blob Worker 的原生 MJS 导入                                  |
| 扩展 content fixture                             | 自动/手动、单次提交、历史、fieldset、action、BFCache、JPX 连续三题通过             |
| remote 双浏览器 load-only                        | Chromium 155.0.8059.79、Firefox 153.0 通过；不代表真实鉴权                         |
| packaged fixture 双浏览器                        | 实际 ZIP 推理与会话重建通过；Chromium 另验证 service worker 重启及旧 epoch 取消    |
| canonical packaged 双浏览器                      | 同两浏览器各两次非随机实际推理与销毁/重建通过                                      |
| bundled 用户脚本 Worker                          | 本地 canonical 模型与精简 WASM 初始化、640×640 图片实际 detect、模型转移及终止通过 |
| Runtime glue/WASM                                | 长度与 SHA-256 通过                                                                |
| High 依赖门禁                                    | 通过，仍有两个 Moderate；依赖与等待策略未变                                        |

| 用户脚本未压缩 profile | 实际字节 | 预算字节 |
| ---------------------- | -------: | -------: |
| external               |   208730 |   262144 |
| bundled                |   290387 |  1048576 |

Worker 检查只使用 test-kv/test-bucket，原生成配置已按字节恢复，备份已清理。原生探针没有留下仓库脚手架。未运行最低 Chromium 116/Firefox 140、Firefox Android 142、生产 Key 鉴权、真实用户脚本管理器或远程 CI/CodeQL；本地 fixture、当前浏览器与 canonical 推理不能替代这些证据。未 commit、push、发布或部署。

另执行 Chromium product 基准：正式 content client → Broker → Offscreen → Worker → ORT 连续识别 100 次、四标签页 12 次请求完成；20 次取消全部取消并成功恢复，结束后各客户端 active=0。4000×4000 合成图片的结果保持一致。localhost 缓存回放只发生一次 GET、一次确认、一次二进制写入及两次元数据写入。此运行使用合成白图，没有准确率结论；CDP 只记录未强制 GC 的堆快照，不能证明峰值或无泄漏，也不与上一版本作端到端性能比较。

`benchmark:ci` 的四场景、1600 次有界 transport 操作通过，仅证明浏览器复制/摘要与 runner 生命周期。最终重新生成 external 用户脚本和 remote 扩展，临时 Firefox driver 与本次浏览器实例已清理。

## 525db8f 后的算法、测试与依赖复审

前述结果属于已提交基线 `525db8f`。后续复审重新覆盖三个应用、两个共用包、构建/检查脚本、静态页面和样式、注释与测试；以下决定和证据不替换前述记录。

### 决定与边界

- YOLO top-N 使用有界原地右移，删除 `splice` 临时数组和已由降序排名保证的重复最大值比较。删除仅由测试/基准调用的宽松解析器，所有调用迁移到严格 `parseYoloOutputTensor`；畸形张量继续失败关闭，不保留别名。
- 删除初始化、共享下载中可由活动任务身份推导的重复字段；移除 test-only `holdOnAbort`、重复错误工厂选项、Worker 文本测试 override 与转发模块。实际运行中 detect 的取消宽限仍由客户端负责，realm 内的测试缓冲复制保留。
- 历史在没有旧根时复用独立键排序；新序号记录直接前置。自动答案候选只去重一次。旧根合并、稳定同分顺序、人工选择和已提交快照裁剪不变。
- 消息 guard 对固定小型键表直接查询，避免每次创建 Set、合并键数组及重复枚举。bootstrap 默认中位数复用 scratch array，分位估计只排序一次；自定义统计函数仍获得独立样本数组。
- 构建目标数组逐项校验，稀疏项在旧产物清理前拒绝。设置页移除 340px body 最小宽度，320px 视口不再横向溢出，不据此扩大浏览器支持声明。
- 去掉重复 ONNX 文档校验，保留唯一校验器及独有条款。静态安全负例复用进程内真实检查器，CLI 拒绝/成功/清理仍有执行证据。测试删减与保留映射见[测试归属决定的补充](../testing/2026-10-14-test-suite-ownership.md#2026-10-22-再审补充)。
- Runtime 许可不能当作冗余注释删除。固定上游 [MIT LICENSE](https://raw.githubusercontent.com/microsoft/onnxruntime/8f0278c77bf44b0cc83c098c6c722b92a36ac4b5/LICENSE)保留在 vendor，完整文本仅加入包含 ORT 的 Worker banner，压缩也保留。原 vendor glue/WASM 不变；这不是完整法律合规结论。

未采用 JPEG/RGBA 新数值约定或更复杂额度状态算法：前者微小收益不足，后者对 live/expired 状态有相反性能影响。保留简单可验证实现，不把某一输入的微基准优势推广到所有请求。

### 局部性能与行为证据

以下各场景均比较同一机器上的旧/新实现；解析与消息使用 Chromium 155.0.8059.79，统计比较使用真实 Node CLI。七次采样中位数，仅表示对应局部负载，不表示端到端推理或峰值内存提升。

| 场景                            | 修改前毫秒 | 修改后毫秒 |
| ------------------------------- | ---------: | ---------: |
| 严格 YOLO，300 随机行/次        |    0.02924 |    0.01132 |
| 严格 YOLO，8400 随机行/次       |    0.29438 |    0.21854 |
| 严格 YOLO，100000 随机行/次     |      3.277 |      2.573 |
| 严格 YOLO，100000 升序行/次     |     17.623 |      8.957 |
| 消息键校验，1000000 次/批       |      225.6 |      100.0 |
| benchmark compare，16 场景/报告 |    468.414 |    399.157 |

独立 oracle 覆盖 2796 份有效张量、69 份非法张量、2097152 种答案候选组合、1000 份历史；消息校验覆盖 16 个调用点的 9120 种键组合。统计比较的 JSON 字节保持一致，另有 18 组独立 BigInt PRNG/rank 参考。原生浏览器复验转移缓冲、共享 GET/回执、最后 owner 取消、同 tick 准备替换、手动项保留、旧目标恢复、面板安全文本与销毁。

历史读取排序次数从两次降为一次，追加从六次降为三次；10000 次读取耗时 298.60/301.33ms，基本中性，不声称读取加速。五个同类 Function sink 负例不再分别启动 TypeScript 进程，保留全部输入/拒绝断言及独立 CLI 回归。设置页实测 320px 下 scrollWidth=320，浅色/深色均无横向溢出，未初始化的敏感控件仍禁用。

### 依赖审计与补丁

全量审计最初发现开发依赖 `@vitest/mocker@4.1.11` 的 [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) 与 [GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp)。仓库没有直接启用公告中的独立 mocker/interceptor 开发服务器；这不免除依赖补丁。

Registry 记录 Vitest 4.1.12 发布于 `2026-10-15T14:51:24.991Z`，到本次 `2026-10-22T15:25Z` 已满足 10080 分钟等待期；两个 coverage provider 与 mocker 同样满足。所有工作区仅升级 Vitest 系列到 4.1.12，同步两个 coverage provider；lockfile 仅变更该版本组及 peer 身份。冻结安装通过，未增加等待期、trust policy 或漏洞忽略例外。

补丁后全量 `pnpm audit --json` 为零公告。原生 Node 导入已安装的 `createManualModuleSource`，执行其生成模块后确认恶意引号只作为参数数据，未执行注入语句；Windows 路径漏洞不声称已在 Linux 原生复现。`audit --prod` 图为空，因为第三方代码在本仓库声明为 devDependencies；ORT 仍会随客户端分发，不能用空图替代全量审计。

已安装依赖许可元数据无 Unknown；同时发现 ORT 上游短声明被压缩剥离，按上述完整 banner 修复。`pnpm outdated` 还报告多个非安全版本更新；不进行无关全量升级。保留的维护风险是已弃用的 [@cloudflare/vitest-pool-workers](https://registry.npmjs.org/@cloudflare/vitest-pool-workers/0.20.3)：当前 peer 接受 Vitest 4.1.x，而新命名包引入独立 Wrangler/Miniflare 升级，本轮不混入该运行时迁移。资产、产品版本、权限与发布门禁不变。

### Python 构建依赖补查

不能把 npm 零公告推广到 Python 工具链。通过 [OSV batch API](https://google.github.io/osv.dev/post-v1-querybatch/)查询哈希锁的八个 PyPI 包、pip bootstrap 和固定 ORT commit，发现以下去重后的 GHSA；对应 PYSEC 别名不重复计数：

| 构建依赖 | 原版本 | 修复版本 | 原公告数量                   |
| -------- | ------ | -------- | ---------------------------- |
| ONNX     | 1.20.1 | 1.22.0   | 8：4 High、3 Moderate、1 Low |
| pip      | 26.1.1 | 26.2.0   | 2 Moderate                   |

ONNX 公告包含 [外部数据符号链接读取](https://github.com/advisories/GHSA-3r9x-f23j-gc73)、[不受保护的对象配置](https://github.com/advisories/GHSA-538c-55jv-c5g9)、[hardlink 绕过](https://github.com/advisories/GHSA-cmw6-hcpp-c6jp)、[不受信任仓库警告抑制](https://github.com/advisories/GHSA-hqmj-h5c6-369m)、[Upsample 空指针](https://github.com/advisories/GHSA-hwpq-hmq9-wj77)、[external data symlink](https://github.com/advisories/GHSA-p433-9wv8-28xj)、[Gemm 越界读取](https://github.com/advisories/GHSA-p893-rvq9-2xf9)和[外部数据 TOCTOU](https://github.com/advisories/GHSA-q56x-g2fj-4rj6)。pip 对应[双重编码索引 URL](https://github.com/advisories/GHSA-qwm4-qh6w-59xr)与[安装入口名称路径穿越](https://github.com/advisories/GHSA-wf93-45jw-7689)。这些是构建/转换依赖，不是浏览器发起的 Python 执行；固定模型输入降低暴露，但不代替修补。

采用覆盖全部公告的最小稳定修复版本，PyPI 发布日期分别为 2026-06-15、2026-07-29，均非 yanked 且已超过七天。uv 按原 Python 3.12/Linux 目标重新生成哈希锁，只改变 ONNX，其他七个锁定依赖保持原版本。两个脚本同步固定 pip；fixture provenance 同步 ONNX 版本。没有替换 ONNX Runtime 1.27.0 或重写 canonical 模型、glue、WASM。

隔离复制真实生成脚本与源码，在 Python 3.12 和 3.14.7 下分别执行 pip 固定安装、`--require-hashes`、模型生成及 ORT 转换。两次结果均与仓库 fixture 按字节相同：1072 字节，SHA-256 为 `b42a0dea98b6d13b8f5485535dbe1e17a4e414bd54e351f117a33be7191907b3`。原生 ONNX 正常 external data 读取成功，替换为指向隔离哨兵的符号链接后以 ValidationError 拒绝。

补丁后重新查询全部八个 PyPI 包、pip 与固定 ORT commit，OSV 无公告且无分页遗漏。未重编整个 ORT/WASM 工具链，未访问生产模型服务；查询结果不证明未知漏洞或操作系统、浏览器二进制没有漏洞。

### 本次复审验证结算

`VITEST_MAX_WORKERS=2 mise exec -- pnpm check` 完整通过，包含 workerd、覆盖率、根测试、类型、lint、文档、架构、危险调用和构建。Python 补丁追加后，八项定向锁/ORT 脚本回归通过，扩展 Node 工具链 162 项重新通过，并再次执行双浏览器 fixture ZIP 推理；没有重复执行整个工作区覆盖率。

| 独立用例归属  | 525db8f 基线 | 最终集合 |
| ------------- | -----------: | -------: |
| 工作区 Vitest |         1243 |     1221 |
| 工作区 Node   |          262 |      257 |
| 根级 Node     |          379 |      377 |
| 合计          |         1884 |     1855 |

净减少 29 个独立用例；原覆盖率链另外运行的 9 个产物用例及本轮定向复验不重复计入。所有已执行用例通过，无 skip/todo，覆盖率门槛不变。旧 Python 安装命令的源码字符串断言退役，哈希锁结构校验及真实 hash-locked 安装/转换证据保留，不重新固定新的版本字符串。

Chromium 155.0.8059.79 / Firefox 153.0 的 remote load-only、fixture 和 canonical packaged 推理通过；用户脚本 Chromium E2E 为 9 项通过，content fixture、320px 设置页、bundled 真实 Worker 及两个包体 profile 均通过。Runtime glue/WASM 原始身份未变，完整 MIT 声明由真实压缩产物回归验证。

product 基准完成 100 次连续识别、四标签页 12 次请求、20 次取消及恢复；客户端最终 active=0，localhost 缓存回放仍为一次 GET、一次确认和一次二进制写入。CI transport 1600 次操作与严格解析 benchmark 命令通过。这里没有同负载端到端基线，不把局部算法收益当作整体推理加速。

| 用户脚本未压缩 profile | 最终字节 | 预算字节 |
| ---------------------- | -------: | -------: |
| external               |   207902 |   262144 |
| bundled                |   290679 |  1048576 |

原 Worker 配置已按字节恢复；两套 Python 隔离环境、临时 driver 与浏览器已清理，默认 external/remote 产物已恢复。未提交、推送、发布或部署；未运行最低版本、Android、生产 Key、真实脚本管理器及远程 CI/CodeQL。Cloudflare 测试集成的弃用仍是明确保留的维护风险，不作为漏洞忽略。
