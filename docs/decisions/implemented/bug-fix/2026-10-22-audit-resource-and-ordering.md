# Agent Note: 取消交接、凭据顺序与有界读取

Status: implemented

## Problem

本轮从干净工作树重新分区审阅三个应用、两个共用包、构建与根脚本、两份 workflow、共享测试工具及维护文档。先用 CodeGraph 定位，再用实际文件清单补齐未索引的 model/build 目录；导出引用结合 LSP 与跨包检索核对。范围是一方源码与契约审计，不包括第三方 ORT 源码、模型准确率证明或线上配置审计。

原生故障注入确认：

- 前方不完整的同 ID 容器遮挡后续验证码的补齐、action 更新和 fieldset 恢复。
- 最后一个准备 owner 取消后，同 tick 新 prepare/detect 加入尚未退场的旧准备，错误继承旧取消。
- 同页旧 GM Key 写入未完成时，新清除先成功，随后旧写入恢复 Key。
- 模型 GET、Key 验证、额度查询和确认取消后，迟到正文未清理；额度/确认 JSON 读取无大小限制，取消后仍锁住流。
- 合法历史文本经 JSON 转义超过旧序列化上限，被当作损坏记录删除；旧根清理重复读取，读失败可能删除有效旧根或误报已提交追加失败。
- Broker 的 clear-key 是唯一不受操作限额保护的请求类型；普通设置加载整份 storage.local，包含历史与无关数据。
- KV 总期限结束后，迟到 miss 仍启动历史大小写查询；geckodriver 保留可复用分块引用，两个 Node 下载器漏掉取消后迟到的正文。

## Decision

1. mutation 沿目标定位最近验证码容器，保留旧活动目标及外层 fieldset 复核；不再依赖第一个同 ID 节点，同时删除每批候选数组和逐记录回调。
2. 新准备可取消地等待已取消代际退场，再共享或新建准备。等待中的取消/销毁不读取模型、不创建 Worker；原身份检查与共享 owner 规则不变。
3. GM Key 设置/清除共用同页写入尾链，失败不阻断下一项；提交回调位于尾链之外。仍以实际 commit 驱动 App 恢复，不宣称撤销已发起操作或提供跨标签事务。
4. 四类模型请求清理迟到 Response。额度与确认复用既有有界流读取，实际正文最多 16 KiB，保留 BOM/合法 JSON 语义和原取消错误；畸形 JSON 不回显正文。HTTP schema、服务端状态码及确认计次不变。
5. 历史序列化上限按三个 1024 字符字段的最坏六字符转义加结构余量推导；文本长度和每世界 50 条上限不变。旧根清理单读，读取失败不授权删除，也不改变已提交追加的结果。
6. clear-key 独立限制为每 Port 一个、后台全局两个，仍可抢占验证；删除无界 other 分类。取消/断连不立即释放槽位，Host 返回或 Broker 超时结算后释放。
7. 普通设置从已有字段元数据生成九键列表。内部 storageGetAll 干净迁移为显式 storageGet(keys)，内容镜像传 null 保留完整快照，无兼容别名。
8. KV 历史查询沿用同一个总期限，迟到读取不再启动后续候选。geckodriver 改为自有有界缓冲、即时复制；它与 canonical 下载器均尽力清理取消后迟到的正文，不改变哈希、期限或重试规则。
9. 删除浏览器支持测试的配置字面副本、参数回声和 smoke 源文本断言；真实版本拒绝、CLI 边界、产物与生命周期证据保留。缓存文档负例改选新增的 16 KiB 契约，仍逐篇验证缺失事实，永久错误条款继续受同一 requiredTerms 分支保护。保留共享 Worker fixture 的 realm 内复制，并补注释说明原因。

检索现有非归档决定后，本篇补充[同日较早审计](2026-10-22-audit-cancellation-and-ci.md)、[有界 IO](2026-09-29-bounded-io-and-lifecycle.md)、[生命周期边界](2026-10-15-audit-lifecycle-and-path-boundaries.md)及[测试归属](../testing/2026-10-14-test-suite-ownership.md)，不翻转其理由，不刷新旧验证结果；没有需吸收的同主题 proposed 记录。

## Alternatives considered

- 仅在新调用方捕获取消并自动重试：掩盖准备代际错误，扩大重试语义；在共享准备入口处理交接更直接。
- 新 Key 操作越过未决 GM 写入：清除看似更快，但无法阻止旧写入后来覆盖；等待真实结算才能保证同页顺序。
- 继续 response.json()、只取消 Response.body：读取已锁流后无法从 body 取消，且没有字节上限；复用现有 reader 原语，不增加第二套流框架。
- 截短历史文本以适应旧 JSON 上限：减少合法数据而非修复序列化边界；提高有界防御上限，保留字段与条数契约。
- 为设置页新建缓存或第二份键常量：增加失效与同步成本；从既有字段元数据选键即可。
- 为所有 Host 依赖增加另一套队列/超时：真实 Key IndexedDB 已有打开和事务期限；本轮只封住 clear 突发准入缺口，不扩展抽象或重试。
- 直接使用 structuredClone 的转移结果替代测试 fixture 复制：同 realm 原生探针可少一次分配，但 Node structuredClone 返回宿主 realm 的 ArrayBuffer，不能通过 jsdom 测试 realm 的 instanceof 检查。完整检查暴露 29 项 Worker 回归失败；原生 vm 探针确认来源已 detach、返回缓冲不属测试 realm。因此撤回此优化，不修改产品 guard 或测试断言掩盖差异。

## Consequences

不改变模型/WASM 身份、客户端版本、权限、支持浏览器、额度协议、依赖或发布门禁。收益来自少读取、少复制、减少废弃工作及释放正文，不宣称整体推理速度、进程峰值或百分比提升。

边界仍明确：GM 永久挂起不能安全跳过；Broker 限制其期限内未结算请求，不能保证任意注入依赖永久忽略取消时的 Host 内部尾链绝对有界；流取消只尽力发起。16 KiB 是客户端 JSON 防御上限，不是新增服务端响应格式。

## Native verification

使用 Node 24.15.0 与 Chromium 155.0.8059.79，真实 DOM/MutationObserver、Blob Worker、ReadableStream、IndexedDB 和设置页 HTML/CSS；模型、GM 与浏览器存储边界采用进程内 fixture，不访问生产服务。

| 场景                      | 修改前                    | 修改后                                           |
| ------------------------- | ------------------------- | ------------------------------------------------ |
| 不完整容器后的验证码补齐  | 有效目标未处理            | 补齐处理一次，action 更新再处理一次              |
| 取消准备后的替代请求      | 继承旧取消，未创建 Worker | 新代际就绪，共享一个 Worker，销毁后无存活 Worker |
| 同页 Key 清除             | 旧写入后来恢复 Key        | 等旧写结算后清除，最终无 Key                     |
| 四类模型请求迟到正文      | 取消调用 0 次             | 各取消一次，reader 不锁定                        |
| JSON 读取中取消           | 正文锁定                  | 取消一次并解锁；16384 字节接受、16385 拒绝       |
| 合法转义历史              | 自行删除                  | 四类转义记录保留；双世界旧根各 50 条             |
| 单 Port 连发 128 次 clear | 128 次进入 Host           | 1 次进入 Host、127 次繁忙                        |
| 设置页 fixture 快照       | 返回 102 个键             | 只请求九键，返回一个存在的相关键                 |
| KV 超时后迟到 miss        | 累计启动两次读取          | 保持一次读取                                     |

另验证历史读失败保留旧根和新记录、设置 clean submit 零写入、修改模式后单字段保存、旧缓存确认不能覆盖新写，以及 IndexedDB 原生异常 close/versionchange 后重开。geckodriver 复用分块摘要正确，两个 Node 下载器迟到正文各取消一次；固定 geckodriver 安装入口实际运行成功。

## Repository verification

固定 mise 工具链，Vitest 最多两个 worker。完整 `pnpm check` 首次在上述跨 realm fixture 优化失败；撤回后从失败的 browser-core 覆盖率阶段续跑，随后完成剩余工作区、根测试、文档、架构、危险调用、包体及构建，不重复已通过的 shared/Worker 测试。

| 检查                                           | 结果                                                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 格式、lint、五工作区类型与构建                 | 通过                                                                                                 |
| 工作区 Vitest                                  | 1210 项通过，覆盖率门槛不变                                                                          |
| 工作区 Node                                    | 250 个用例通过；另按既有脚本单独重跑 9 项产物覆盖率门禁                                              |
| 根级 Node                                      | 364 项通过，无 skip/todo                                                                             |
| 文档事实/链接/笔记、架构、危险调用、Action pin | 通过                                                                                                 |
| 用户脚本 Chromium E2E                          | 9 项通过，含 external Blob Worker 原生 MJS 导入                                                      |
| 扩展 content fixture                           | 自动/手动、单次提交、历史、fieldset、action、BFCache、JPX 连续三题通过                               |
| remote 双浏览器 load-only                      | Chromium 155.0.8059.79、Firefox 153.0 通过，不代表真实鉴权                                           |
| packaged fixture/canonical 双浏览器            | 同两浏览器通过实际 ZIP 加载、非随机推理与会话重建；fixture 另验证 service worker 重启及旧 epoch 取消 |
| 用户脚本 bundled 真实 Worker                   | 本地 canonical 模型与固定 WASM 初始化、实际 detect、终止通过                                         |
| Runtime glue/WASM                              | 本地长度和 SHA-256 通过                                                                              |
| High 依赖审计                                  | 通过；仍有两个 Moderate，依赖与等待策略未变                                                          |

| 用户脚本未压缩 profile | 实际字节 | 预算字节 |
| ---------------------- | -------: | -------: |
| external               |   208603 |   262144 |
| bundled                |   290260 |  1048576 |

Worker 验证仅用测试绑定，原生成配置已按字节恢复。临时探针与服务已清理，最终产物恢复为 external 用户脚本与 remote 扩展；未 commit、push、发布或部署。未运行最低 Chromium 116/Firefox 140、Firefox Android 142、生产 Key 鉴权或远程 CI；本地 fixture、当前浏览器及本地 canonical 推理不替代这些证据。
