# Agent Note: 字节流、取消清理与面板观察精简

Status: implemented

## Problem

第三轮沿用前两轮未提交工作树。共用字节读取器信任静态类型，DataView、多字节数组或伪造长度对象可被错误复制为补零数据；未知长度扩容还复制尚未写入的容量。取消竞争的清理回调同步抛错会覆盖取消或使等待者未结算，异常对象的 getter/字符串转换也会令错误展示再次抛错。

面板观察器为每批 mutation 搜索新增/删除子树，并保存外部记录以重放可见性判断。提交校验只检查 form/type，具有这些原生属性的 HTMLObjectElement 可被误当按钮并报告提交成功。用户脚本 Solver 已只剩默认参数转发，重复类与测试继续增加维护入口。用户脚本发布 job 在未授权上传时仍进行安装与构建。共享 ZIP 读取器未校验 CRC，危险调用门禁也漏掉解构与循环中的 innerHTML 赋值。

## Decision

- 共用正文读取只接受真实单字节元素视图，兼容跨 realm；非法块立即拒绝并清理 reader。未知长度扩容仅复制已写入区间，保留原有长度、摘要和取消约束。
- raceAbort 在清理前保存取消原因；清理同步抛错、异步拒绝或未决均不延迟拒绝，自定义错误工厂失败沿用信号原因。错误格式化读取各属性一次，并在属性读取或字符串转换失败时显示固定未知错误。
- 面板观察每批变更后的当前 DOM，常见 csp 查询走 ID 索引，首个同 ID 非 div 时回退；渲染前后复核挂载及可见性，删除子树遍历与 MutationRecord 重放。
- 提交入口验证原生 HTML input/button，类型联合与目标快照一致；保留等待后、每次点击前后的身份与手动归属复核。
- 用户脚本依赖装配直接创建核心 Solver，删除纯转发子类及其重复测试；平台接线继续由应用 smoke 和 E2E 验证。
- ZIP 读取器复用 Node zlib 的 crc32，核对本地头/中央目录与解压数据；保留有界解压和路径校验。危险调用门禁递归识别解构、rest、默认值和 for-in/of 写入目标，普通读取不误报。
- userscript-artifact job 仅在显式发布输入且所需检查通过时启动。coverage-build 的双包体检查、可选 E2E 门禁和上传权限保留。

本篇补充[前轮决定](2026-10-29-dom-snapshots-and-recovery.md)及[测试归属](../testing/2026-10-14-test-suite-ownership.md)。Offscreen 文档同时明确：同 epoch 取消保留槽位至 Host 结算，新 epoch 接管清除旧代际计数；既有实现与回归不变。没有需要移除的 proposed/rejected 记录。

## Alternatives considered

- 使用 instanceof Uint8Array 校验流块：会拒绝跨 realm 的合法字节视图，采用 ArrayBuffer.isView 加元素宽度校验。
- 等待清理 Promise 后拒绝：无法约束忽略取消的清理，取消仍需立即交付。
- 为面板维护 mutation 派生的 csp 计数：需要处理子树、重复 ID、body 替换及自身重绘，直接查询当前 DOM 更简单。
- 保留转发类作为兼容别名：该类只有内部调用者，移除后核心测试和实际应用装配已覆盖行为，无需新增兼容入口。

## Consequences

无新增依赖、权限或资产变更。有效流与正常错误格式保持原行为，畸形流更早失败；取消后的底层任务仍仅尽力清理。面板减少无关 DOM 工作，Solver 与发布流程减少重复入口。测试保留安全、取消、并发和原生按钮行为，具体证据见[第三轮审计](../../../audits/2026-10-29-resource-and-maintainability-audit.md)。
