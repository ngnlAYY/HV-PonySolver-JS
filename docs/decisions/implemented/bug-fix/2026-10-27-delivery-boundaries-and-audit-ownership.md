# Agent Note: 结果交付取消、月界重试与审计职责归并

Status: implemented

## Problem

核心推理的内部准备或检测已成功、公开方法的续体尚未执行时，取消或销毁仍可能收到成功结果。Worker 待确认槽位占满后只按回执 TTL 建议重试，月末会要求等待十分钟，尽管下个 UTC 月已经可以重新预留。

扩展产物遍历静默遗漏符号链接；两个 Node 下载器在已排队的操作执行前取消，仍会派发 fetch。笔记树检查另有一套链接正则，会拒绝代码围栏中的示例，并重复已有结构与链接扫描。页面 smoke 重复构建相同 bundle，根测试还锁定部分脚本文字。

## Decision

- 核心 `prepare()`、`prepareFromVerifiedModel()` 与 `detect()` 在内部工作成功后、公开结果交付前复核请求与客户端生命周期；保留会话复用、串行检测和活动取消宽限。
- `reservations-full` 的重试秒数取最早 pending TTL 与下个 UTC 月界中的较早者，向上取整且至少一秒。已确认额度耗尽继续独立等待月界。
- 产物 inventory 拒绝符号链接与其他非普通条目。canonical/geckodriver 下载器在 deferred operation 执行前再次检查信号，保留原取消原因及迟到正文清理。
- 删除重复的 `verify-agent-note-tree.ts` 入口。格式检查器已经调用同一树扫描并检查全部结构错误；链接由 `document-links.mjs` 统一负责，`docs:check` 保留完整校验链。断链回归迁至链接检查器，笔记围栏回归加入示例链接。
- 用户脚本页面 smoke 在每个 Playwright worker 的 `beforeAll` 构建一次 bundle，删除无消费者的 cache fixture，保留全部页面场景和独立上下文。删除四项只验证 package/工作流命令文本的测试；发布授权、已测 ZIP 复用、工具链安全策略和实际完整检查保留。

本次检索相关活跃记录后，保留[额度时间与扩展交付边界](2026-10-27-quota-boundaries-and-audit-simplification.md)、[有界 I/O](2026-09-29-bounded-io-and-lifecycle.md)、[MV3 边界](2026-09-29-extension-mv3-boundaries.md)、[文档职责](../process/2026-09-16-documentation-rebuild.md)和[测试归属](../testing/2026-10-14-test-suite-ownership.md)。本篇补充其未覆盖的交付时点、重试期限与职责归并；没有相关 proposed/rejected 记录需要替换。

## Alternatives considered

- 仅在内部操作或 Worker 响应处检查取消：漏掉其后到公开方法续体之间的微任务窗口；也不能撤回已经交付的结果。
- 满槽一律等待 TTL：实现简单，但与新月清空 pending 的状态机矛盾。
- 跟随符号链接或只审计被引用条目：清单会与实际树不一致；拒绝非普通条目保持构建输入边界明确。
- 给笔记正则补围栏和行内代码解析：继续维护两套链接语义并重复读盘，已有统一检查器覆盖更完整。
- 为脚本文字测试重新固定新文字：继续耦合实现；实际命令执行和保留的安全/行为回归提供相应证据。

## Consequences

产品版本、模型身份、权限、月额度、TTL、HTTP 状态码及依赖版本不变。每次笔记验证少启动一个 Node 子进程、少扫描一次活动笔记树；同一 worker 正常顺序执行的九个页面场景共用一次构建。未测量整题推理提速，不把这些执行次数变化当作算法基准。

新增回归保护四种核心交付竞态、普通月末和跨年重试、两种 symlink、两种下载取消。覆盖率门槛/include 与发布门禁不变；本地 fixture、内存 Worker 和当前桌面浏览器证据不代替生产 Key、最低版本或 Android 验收。

实际源码覆盖、依赖查询、定向回归、完整检查与双浏览器证据见[本轮审计](../../../audits/2026-10-27-delivery-and-tooling-audit.md)。
