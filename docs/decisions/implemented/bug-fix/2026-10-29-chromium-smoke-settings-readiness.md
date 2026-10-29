# Agent Note: Chromium smoke 等待普通设置加载

Status: implemented

## Problem

提交 `6ece4d7` 的 [Repository CI](https://github.com/ngnlAYY/HV-PonySolver-JS/actions/runs/40869589490) 在 Chromium remote load-only 步骤失败：保存后读取 `hvPonySolverRandomOnFail` 得到 `undefined`，预期为 `'0'`。

设置页初始 HTML 的随机兜底复选框未勾选，异步读取普通设置后才应用默认开启状态。smoke 在加载完成前调用 `uncheck()` 时，它可能直接返回而不触发事件；随后设置加载将复选框勾上。保存按钮会等待加载结束，但之前的空操作没有留下修改意图，因而只保存两个已编辑的延迟字段。packaged Chromium smoke 使用相同操作顺序，也有这一窗口。

## Decision

remote 与 packaged Chromium smoke 共用 `ordinary-settings-smoke.mjs`：最多等待 15 秒，确认保存按钮已启用，再设置自动模式、零延迟和关闭随机兜底。保存后只读取三个相关普通设置键，并逐项验证实际持久化值；packaged 的非随机推理证据继续取自已验证的存储结果。

回归使用真实设置页 HTML 和分别打包的 remote/packaged 设置入口，仅替换浏览器存储与自动化适配；将首次存储回调延迟至自动化等待阶段。这样可确定性复现旧顺序的失败，不靠延长睡眠或反复运行碰运气。

检索活跃决定后，本篇补充[设置首次加载的用户编辑保护](2026-10-15-audit-lifecycle-and-path-boundaries.md)和[测试归属](../testing/2026-10-14-test-suite-ownership.md)，不改变其理由；没有需要吸收的同主题 proposed 记录。

## Alternatives considered

- 固定等待若干毫秒或失败后重跑：与实际存储是否加载完成无关，仍受 CI 调度影响。
- 允许缺失键通过断言：缺失时运行时使用默认开启的随机兜底，会破坏后续非随机推理证据。
- 为测试改变产品默认值或强制写入所有字段：扩大产品行为变更；本次只修正自动化的操作时序。

## Consequences

两种 Chromium smoke 使用同一就绪条件与存储校验。初始化失败时按有界等待失败，普通设置、生产模型访问、版本、权限和 CI 发布门禁保持原契约。

旧顺序已由延迟加载回归复现与 CI 相同的 `undefined !== '0'`；验证范围与执行入口见[验证手册](../../../development/verification.md#浏览器证据边界)。
