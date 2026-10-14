# Agent Note: 图片选源、设置取消与产品首次上传门禁

Status: implemented

## Problem

2026-10-12 从当前工作区重新审计后确认八项问题：两个 High 依赖公告；canonical 完整产品在发布授权和 CodeQL 门禁前上传；响应式图片切换时旧答案仍可提交且新图漏扫；未决 GM 设置读取阻塞下一题；首次 body 暂缺中止初始化；保存 Key 时转小写破坏历史 KV 兼容；下载配置错误将凭据带入原生异常；ORT 锁文件符号链接可截断目录外文件。复核首次上传时也发现 remote 的中间 ZIP 尚未等待全部发布门禁。

## Decision

- 升级 `sharp` 至 `0.35.5`、关联 libvips 包至 `1.3.4`、`source-map-js` 至 `1.2.2`，提高 override 下限并由 pnpm 生成锁文件。保留工具链版本、最低发布年龄和 `audit:high` 阈值，不豁免公告。对应 [sharp 公告](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w)与 [source-map-js 公告](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)。
- `CaptchaTarget` 保存 img 的 `src`、`srcset`、`sizes` 及 picture source 身份和属性，声明变化立即使旧任务失效。响应式图片等待 `complete` 和 `currentSrc`，不退回旧 `src`；App 捕获 load/error 补扫并在销毁时移除监听。普通 src 图片仍使用解析后的地址，不等待 DOM 图片加载才通过平台读取。
- 答题模式和两种延迟读取共用可取消的限时等待，期限由 `inferenceTimeoutConfig.settingsReadTimeoutMs=5000` 管理。预取消不读取，结束清理定时器/监听器；旧读取迟到结算不恢复旧轮次。存储调用本身不可撤销。
- 面板首次创建复用 `configureDomObserver` 与 `syncDom`，body 暂缺时先观察等待，App 扫描仍正常初始化；后续继续挂载同一节点。
- Key 格式校验与存储分离：保存去除首尾空白后的原始大小写，保持 HEAD 验证、后续下载与历史 KV 查询一致；服务端规范化额度身份不变。
- canonical 下载器验证 HTTPS URL 和 Bearer 格式，拒绝 URL userinfo。原生 URL、fetch 与流错误不携带原始 cause；CLI 只输出本模块可信诊断或固定失败消息，release preflight 同样不保留 URL 解析 cause。
- ORT 构建用已验证根目录的只读描述符持有 `flock`，锁后复核目录身份，不读取、创建或截断 `.build.lock`；互斥跟随目录 inode，遗留锁文件替换不能绕开它。
- remote 和 canonical 的完整 ZIP 首次上传均等待显式发布输入、当前 CodeQL 及全部相应发布门禁。Android 外部证据下载和同一 ZIP preflight 移入 canonical 构建 job，产品此前只保留在本地；删除提前上传的 canonical 中间 artifact 及独立 Android job。最终发布继续复用已测试 ZIP 并显式依赖 CodeQL。普通 CI 可执行验证，但不上传完整产品。

## Alternatives considered

检索非归档 lifecycle 后，[主动取消](2026-10-02-audit-regressions.md)、[验证码恢复](2026-09-22-captcha-recovery-and-manual-selection.md)、[面板挂载](2026-09-16-status-panel-remount.md)、[构建安全](2026-09-22-build-safety-and-reproducibility.md)和[工具链安全](2026-09-29-test-toolchain-security.md)均部分重叠，保留原决定及验证时点；本篇补齐等待、初始挂载和首次上传边界，没有需吸收或废弃的 proposed/rejected 记录。

- 只比较 `currentSrc` 或等待另一次 mutation：代码更少，但浏览器加载期间可保留旧值或暂时清空，加载完成也未必产生 mutation；同时检查声明与加载事件。
- 只在设置 Promise 返回后检查取消，或让多个 Solver 并行：前者无法释放挂起等待，后者破坏单次提交和答案归属；保留串行状态所有权，以取消和期限结束等待。
- 迁移所有 KV Key 为小写：可统一历史数据，但依赖线上迁移且不可由本地修复推断完成；客户端保留验证值即可兼容现有条目。
- 只移除 `.build.lock` 的截断标志：仍可能跟随链接，替换文件也可能分裂锁身份；目录描述符直接锁定需要互斥的资源。
- 只保护最终发布 job，或让中间 ZIP 短期留存：下载权限不因名字带 transfer 或保留一天而变化，完整产品必须在首次上传前完成门禁。
- 先上传 ZIP 再补 Android 校验，或最终 job 重新构建：前者保留原缺口，后者会断开测试证据与最终字节身份；在持有原产物的 job 内完成校验。

## Consequences

图片源、设置等待和首次挂载均受当前轮次与页面生命周期约束；Key 不再丢失已验证的大小写。已经被旧版本转小写的存储无法恢复原信息，需要用户重新输入原 Key。

首次上传等待更多 jobs，CI 的扩展验证阶段会更晚开始；取消、缺凭据、缺 Android 证据或任一所需门禁失败仍阻止发布。代码错误保留阶段/状态/完整性类别，但不再保留可能包含配置的底层异常链。ORT 的目录锁依赖既有 Linux `flock` 工具；根目录不能在持锁期间被替换。

回归覆盖真实 Chromium 慢加载图片、未决 GM 读取、body 初始缺失，模拟存储及 Worker 的历史 Key 兼容，实际 ORT shell 入口的外部哨兵与并发互斥，下载 CLI 脱敏，以及真实 workflow 条件的失败/跳过/取消矩阵。文档检查增加选源、设置期限、初始挂载和 CI job 表的一致性保护。

本次本地验证通过 `mise exec -- pnpm check`（含覆盖率和全仓构建）、依赖审计（无已知漏洞）、Actions 固定检查、文档回归和两种用户脚本包体预算。用户脚本 E2E 为 9/9；扩展内容脚本回归、Chromium 154 / Firefox 153 的远程版 load-only 和内置 fixture 推理均通过。

本地 fixture、load-only 与安全审计不证明生产模型鉴权、最低浏览器版本、Android 真机或远程 CodeQL 告警状态；这些仍沿用各自独立证据门禁。
