# Agent Note: 历史失败缓存、Offscreen 确认期限与协议校验复用

Status: implemented

## Problem

损坏的独立键历史 JSON 每次读取都重新解析并告警，持久化清理失败时持续增加 CPU 与日志开销。Chromium 的 claim 已有超时，但 confirm-idle 永久未返回会让关闭等待持续阻塞新请求准入。Worker 与扩展还重复实现对象/字段集合校验；三个工作区直接声明了没有调用的 TypeScript 6 API 包。

## Decision

- 在既有最多 100 项解析缓存内保存损坏 JSON 的失败结果；按 key/原始值失效，发现删除时淘汰。读取仍只读，损坏项仍参与完整已提交快照的裁剪。
- claim 与 confirm-idle 共用 `OFFSCREEN_CONTROL_TIMEOUT_MS` 的 5 秒上限与同一发送助手。超时只终止等待，保持已有关闭门禁和有限退避；迟到响应不能关闭文档。业务响应取消复用核心 `raceAbort`，保留远端取消消息。
- 对象/字段集合校验统一放在 `browser-core/utils/guards`，新增明确公开子路径供扩展协议使用；领域字段、来源、大小与错误分类仍由各层验证。扩展图片上限直接引用核心预处理配置。
- 删除 shared、browser-core、Model Worker 的 TypeScript 6 声明，保留实际调用该 API 的根包、userscript 与 extension；各工作区原生 CLI 与锁定版本保持不变。
- 协议边界用例共用数据表，文档负例按所属文档合并同次故障注入，逐项检查全部诊断；不降低覆盖率门槛或删除安全断言。

检索活跃决定后，本篇补充[历史与资源排序](2026-10-22-audit-resource-and-ordering.md)、[Offscreen 生命周期](2026-10-15-audit-lifecycle-and-path-boundaries.md)和[测试归属](../testing/2026-10-14-test-suite-ownership.md)，保留原决定；没有需要替代的相关 proposed/rejected 笔记。

## Alternatives considered

- 读取时立即删除损坏历史：会绕过已提交快照和并发写入边界，继续由原裁剪路径处理。
- 仅吞掉重复日志：仍需反复解析与构造异常，复用有界失败缓存同时避免这两项成本。
- 给整个 Offscreen closeDocument 操作加超时后直接放行：原生关闭无法撤销，迟到关闭可能影响新请求；只给无副作用的确认等待加期限。
- 删除所有工作区 TypeScript 声明：会隐藏实际 CLI/API 所有者；只移除没有直接 API 调用的兼容包声明。
- 按测试数量删除用例：会损失边界覆盖，只合并重复输入构造和相同文档检查分支。

## Consequences

损坏历史的告警随缓存项失效重新出现，缓存容量与文本上限不变。Offscreen 确认失败后保持文档可用，等待后续有效确认再关闭；消息协议与业务请求期限不变。字段集合检查只有一个实现，独立领域校验仍保留。

依赖声明减少三项，传递依赖图仍需要 TypeScript 6；本轮无依赖版本升级。复现、局部基准和验证证据见[后续审计](../../../audits/2026-10-27-maintainability-follow-up.md)。
