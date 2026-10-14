# Agent Note: 全仓审计的秘密边界、生命周期与证据校验修复

Status: implemented

## Problem

离线审计确认十项缺口：Playwright 的 Key 输入失败日志回显输入；外层 fieldset 禁用未进入目标取消/恢复；Offscreen 空闲确认重置关闭重试预算；同步 GM 读取丢弃 rejected Promise；文档提取器吞掉 satisfies 后的运行时表达式、接受状态码数字前缀；直接封印入口将无效 Git 基线当作无历史清单；benchmark 接受与声明采样量不符的报告；并发推理基准互删固定临时目录；两条文档回归使用失效源码锚点。

文档与 benchmark 问题是校验器错误通过，不表示当前生产 Worker 已返回错误状态，也不表示正常 runner 自行产出虚假报告。秘密日志仅用公开假值复现，未使用真实 Key。

## Decision

1. Chromium authenticated smoke 在读取/输入 Key 前拒绝非空 DEBUG/PWDEBUG。输入边界捕获 Playwright 异常并抛固定安全错误，不携带原异常、cause 或 call log；保留其他阶段的非敏感诊断。
2. App 把包含验证码的外层 fieldset 的 disabled 与直接子节点 mutation 纳入现有身份复核，覆盖首个 legend 顺序变化。取消仍依据有效控件快照，不取消 legend 例外或无关 fieldset 中未变化的目标；启用后补扫，旧 prepare 迟到不能继续触发。
3. 同一 Offscreen 空闲代际不因 confirm-idle 重置退避和通知上限。只有实际活动或新代际恢复预算；确认不等于 closeDocument 成功。
4. 同步 GM 快照遇异步返回时继续使用原默认/回退规则，但非阻塞消费该次 Promise 拒绝。独立异步读取的错误处理与 Key 存储边界不变。
5. 文档字符串事实复用现有 TypeScript parser 检查完整 initializer，仅剥离类型包装。HTTP 状态要求完整数字实参，非字面量拒绝提取；不求值表达式或执行待审源码。
6. Git 仓库内的直接归档入口先解析基线为 commit，再用该身份查询清单是否存在。基线或读取失败计为错误，验证失败不得重写 manifest；合法基线确实没有清单仍允许首次追加。
7. benchmark 每场景的 invocation 总数、从零起连续唯一的索引、每次 warmup/measured 数量必须与 config 完全相同，降低采样的诊断模式也不例外。已有 summary 重算和完整矩阵检查继续保留。
8. 用户脚本推理基准在应用 .tmp 下用 mkdtemp 分配本次目录，保留包解析上下文，只清理本次目录。用双进程构建屏障覆盖另一进程成功和失败两条清理路径，纳入应用 test/test:coverage。
9. 两条文档回归改在当前 request-router 对象读取/空值分支上注入变体，替换前后断言锚点与变体存在。嵌套 dead-decoy 用例移除真实处理，只留下死分支中的旧处理，避免另一项独立漂移掩盖空跑。

## Alternatives considered

复核非归档 lifecycle：[主动取消](2026-10-02-audit-regressions.md)、[上次审计修复](2026-10-12-audit-follow-up.md)和[文档归属](../process/2026-09-16-documentation-rebuild.md)部分重叠，保留原决定和验证时点。本篇补边界，不翻转产品模式、发布授权或最低浏览器支持；没有需吸收或废弃的相关 proposed/rejected 记录。

- 依赖 CI 的秘密遮罩，或仅替换异常 message：本地没有相同遮罩，stack/cause/debug 日志仍可能包含输入，故在敏感操作边界丢弃原异常并拒绝调试模式。
- 全页 mutation 都取消：更简单，却会中断未变化目标。只扩大与有效禁用有关的相关性过滤，复用原取消和防抖路径。
- 确认后无限重试关闭：可能最终回收，但持续唤醒后台；同代际预算用尽后停止，新活动再恢复。
- 增加正则特殊情况或运行源码求值：前者继续误判 TypeScript 表达式，后者突破只读提取边界；复用已有 AST parser，只识别允许的字面量。
- 只依赖封印包装器或 benchmark 最低采样量：公开直接入口和已有 JSON 比较仍可放行错误证据；消费边界必须独立校验。
- 为推理基准加全局锁：可串行化，但没有共享状态必须互斥；独立目录更小，失败清理不影响并发进程。

## Consequences

无新依赖、权限、版本或生产协议变化。Key 输入失败牺牲底层异常细节；诊断须用公开假值离线重现，不放宽受保护日志边界。文档解析更严格，含运行时表达式的事实必须改回受支持字面量或显式扩展提取契约。

旧 benchmark 报告若声明与实际数量不符，需要重新生成；降低采样的 smoke 仍不能作为正式性能或发布证据。Offscreen 达到回收预算后可能暂时驻留，但不会无限通知；后续实际活动重新启用有限回收。

回归覆盖秘密错误的 message/stack/cause/stderr、立即取消与 legend 例外、确认后退避与上限、GM 未处理拒绝、表达式故障注入、无效/非 commit 基线下不改封印、采样数不一致、并发目录隔离及失效 fixture 锚点。完整验证遵循[验证手册](../../../development/verification.md)；真实 Key、最低浏览器版本、Android 和远程 CodeQL 仍需独立证据，离线检查不能代替。

本轮完整 `pnpm check` 在工作区串行、Vitest 两个 worker 下通过，没有跳过测试或降低覆盖率门槛。默认并行的首次覆盖率运行中，五条既有测试超过五秒；保留失败记录，不把串行绿灯当作并行稳定性证明。用户脚本 Chromium E2E、扩展双浏览器远程 load-only、内置 fixture 与本地正式模型 E2E 均通过；离线 Chromium 另核对错误不含假输入、旧轮次不触发、GM 无未处理拒绝及同代际恰止于十次通知。未访问生产模型服务。
