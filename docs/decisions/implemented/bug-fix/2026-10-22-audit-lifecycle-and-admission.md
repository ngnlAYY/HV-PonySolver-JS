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
