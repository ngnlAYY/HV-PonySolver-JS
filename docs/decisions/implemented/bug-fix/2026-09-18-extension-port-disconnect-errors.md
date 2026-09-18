# Agent Note: 同步消费扩展 Port 断连错误

Status: implemented

## Problem

Chromium 在页面进入 BFCache 时主动关闭扩展消息通道，并在 `onDisconnect` 回调期间暴露 `runtime.lastError`。后台 Broker 和内容客户端只清理连接，设置页只读取 Firefox 的 `port.error`，因此正常页面导航也会出现 `Unchecked runtime.lastError`，其他 Chromium 断连原因也丢失为通用提示。

## Decision

平台层的 `readPortDisconnectError` 在断连回调内同步读取 `runtime.lastError`，以 Firefox 的 `port.error` 作为兼容来源，去掉空白并在没有具体原因时返回 null。三个 Port 消费者统一调用该函数；内容客户端在检查 Port 身份前读取，避免迟到的旧回调留下未消费错误。

内容客户端和设置页用具体原因拒绝未决请求，没有原因时继续使用原来的中文提示。Broker 读取错误后仍按断连取消该 Port 的请求，保留 Host 结算前的并发计数，不向已断开的页面发送迟到结果，也不新增页面导航日志。

现有 `pagehide.persisted` 取消与 `pageshow.persisted` 重建应用的流程保持有效。内容请求按需建立新 Port；设置页仍仅允许额度查询重连一次，模型下载与 Key 操作不自动重放。处理错误不改变消息 schema、权限或模型存储契约。

## Existing record audit

检索全部非归档决定中的 BFCache、Port、pagehide、pageshow、断连与 lastError，没有已有同主题决定。现有[面板恢复决定](2026-09-16-status-panel-remount.md)处理同一应用内的 DOM 节点移除，与浏览器冻结页面时销毁并重建应用的生命周期无关；[文档重建决定](../process/2026-09-16-documentation-rebuild.md)仅提供记录归属，均不被本篇取代。

## Alternatives considered

- 在三个回调中分别读取浏览器全局对象：代码改动可以很少，但会重复 Chrome／Firefox 的 API 选择和空错误处理，后续容易再次遗漏；统一使用现有平台适配层。
- 在平台层包装所有 Port 和事件：能让每个调用者自动消费错误，但要引入 Port 身份、事件监听器映射及解绑规则。当前只有三个消费入口，显式辅助函数更便于保留既有连接身份和清理行为。

## Verification

回归在回调期间临时安装 `lastError` getter，返回后立即移除，检查三处消费者均同步读取。内容端还验证迟到旧回调不影响新 Port；Broker 验证取消传播、并发计数释放及迟到响应丢弃；设置页验证真实原因保留且下载不重放。平台测试覆盖 Firefox 错误、无错误与空白原因，既有页面生命周期测试和 Chromium content smoke 验证 BFCache 恢复后仍只提交一次。

浏览器 smoke 使用离线 fixture，不证明线上 Key 鉴权、生产模型推理或最低版本／Android 支持。

## Consequences

页面导航不再因这三处回调漏读错误而产生未处理告警，其他断连原因仍可诊断；代价是新增 Port 消费者必须遵守同步读取约束。它不会保持 BFCache 中的通道，也不会恢复已取消操作。若消费者数量或 Port 适配复杂度继续增长，再评估统一事件包装。
