# 2026-10-27 可维护性与稳定性后续审计

基线 `35d403a`，开始时工作区干净，本地 main 比 origin/main 领先一个提交。基线盘点包括 435 份第一方文本文件，其中 148 份位于运行时 src、45 份位于 docs。本次核对依赖清单与文档，按模块重点审阅源码、注释和测试，并执行全仓静态与回归门禁。第三方 Runtime 保留资产身份和许可证，历史审计不改写原证据。

## 覆盖范围与改动

| 范围               | 审阅重点与结果                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| shared             | 模型、答案、令牌、ORT 契约；保留纯契约，删除未使用的 TypeScript 6 直接声明                                  |
| browser-core       | DOM 快照、答案归属、推理排名、取消、下载/缓存、面板/历史；缓存损坏 JSON 的解析结果，统一对象/字段集合校验   |
| userscript         | GM 敏感存储、Key 写入、运行时加载、薄适配与构建；保留平台边界，随核心复验                                   |
| extension          | 协议、Broker、Offscreen、Host、Key 库与设置镜像；修复空闲确认无限等待，复用取消和协议助手，图片上限统一来源 |
| Model Worker       | KV 截止时间、R2 完整性、DO 回执事务、HTTP/CORS；保留状态与协议，删除未使用的 TypeScript 6 声明              |
| scripts / CI       | 构建与包体、产物审计、文档漂移、发布门禁；文档负例合并重复扫描，既有产物与发布约束保持                      |
| 文档 / 注释 / 测试 | 更新权威架构、扩展专题、验证手册、README/导航与 AGENTS；修正并精简超时层级注释，保留安全行为断言            |

实现取舍见[决定](../decisions/implemented/bug-fix/2026-10-27-history-cache-and-offscreen-control.md)。推理已采用固定 top-N 排名、单次严格验证与可复用像素缓冲，本轮保留数值、模型身份和答案语义。

## 缺陷复现与性能

新增回归在基线先失败：重复读取同一损坏 JSON 产生两次告警；confirm-idle 未返回时，新 Offscreen admission 在既有 5 秒控制期限后仍未完成。修复后确认超时释放等待，迟到成功/失败均不关闭文档，下次有效确认正常回收；损坏历史仍可被外部替换、删除和安全裁剪。

历史微基准使用 Node.js 24.22.1，将基线与修改后模块各自打包，在同一进程交替测量。每组 50 条独立键，预热各 1000 次，9 批、每批 2000 次；控制台输出关闭，两实现返回结果逐项一致。

| 损坏记录数 | 基线中位 ms/次 | 修改后中位 ms/次 |
| ---------- | -------------- | ---------------- |
| 0          | 0.02867        | 0.02784          |
| 1          | 0.04494        | 0.03032          |
| 25         | 0.34458        | 0.02683          |

含一条损坏记录时该局部读取成本下降约 32.5%；收益来自避免重复 JSON 解析和异常构造。正常数据差异较小，不据此声称整题推理提速。失败项与有效项共享原有最多 100 项缓存，没有新增无界缓存。

测试精简保留：Base64 恰好上限/相同编码长度超限/编码长度超限三种情况，空 Key/畸形 Key 两种拒绝，清除/下载/额度查询三种消息的合法形状与多余 Key 拒绝。文档故障注入仍逐篇拒绝缺项，README 的同名摘要不能补足主题文档；同一文档一次注入多个缺项并检查全部诊断。

## 依赖

包含开发依赖的 `pnpm audit --json` 返回 0 个已知公告。删除三个无直接编译器 API 调用的工作区的 TypeScript 6 声明，锁文件仅删除对应 importer 条目；保留各包的 TypeScript 7 CLI。根检查器、用户脚本资产解析器和扩展产物审计器实际使用 TypeScript 6 API，继续直接声明。传递图仍为 363 项，没有新增依赖或改动锁定版本。

ORT、esbuild、fflate、jsdom/Playwright、Cloudflare pool/Wrangler/types、Vitest 及两个 coverage provider 均有实际调用或运行时用途。已弃用 Cloudflare pool 的迁移继续按独立兼容任务处理，供应链等待期与 trust policy 不变。

Python 哈希锁八项及两个 bootstrap 共用的 pip 26.2.0 已逐版本查询 PyPI JSON，`vulnerabilities` 均为空；这是该接口的公告范围，未重建 ORT 或替换固定模型。

## 验证

所有验证使用 mise 固定工具链。默认并发的完整检查曾在既有图片队列 GC 子进程回归触发 5 秒超时；该文件随后定向 36 项通过。最终完整检查限制工作区串行，并让 Vitest 使用两个 worker：

```bash
PNPM_CONFIG_WORKSPACE_CONCURRENCY=1 taskset -c 0-2 mise exec -- pnpm check
```

这是本机 Linux 的验证资源设置，未改仓库默认并发、测试超时、coverage 门槛或 include；没有新增 skip/todo。首次新增测试的 lint 问题已修正，最终检查无 lint 错误或警告。

| 验证                 | 结果                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 冻结安装与 npm audit | 通过；363 项传递依赖，所有严重度告警均为 0                                                                                           |
| 完整 `pnpm check`    | 上述资源设置下通过：1,396 项 Vitest、根级 383 项 Node 测试及包内 Node/覆盖率、格式、lint、类型、文档、架构、危险调用、产物审计与构建 |
| Action pin 与 diff   | `assert-pinned-actions.mjs`、`git diff --check` 通过                                                                                 |
| 用户脚本双 profile   | default 206644 字节，bundled 156578 字节，各自预算通过；default 未压缩、bundled 压缩                                                 |
| 用户脚本 E2E         | Chromium 10 项通过                                                                                                                   |
| 扩展 content fixture | 自动/手动答题、单次推理/提交、独立键历史、fieldset 恢复、提交地址变化、BFCache、JPX 连续三轮通过                                     |
| remote load-only     | Chromium 156.0.8078.47 与 Firefox 153.0 通过                                                                                         |
| packaged fixture     | 两浏览器校验 ZIP、执行真实 ORT 推理并重建会话；Chromium 另覆盖后台重启、旧 epoch 取消、空闲关闭和重建                                |
| packaged canonical   | 复用现有固定模型，两浏览器完成两次非随机推理与重建，模型长度/SHA-256 与清单一致                                                      |

生成的 Worker 配置已在仓库外备份，测试使用 test-kv/test-bucket，结束后按原字节恢复。Firefox 使用已安装的 Playwright Firefox 和经版本核对的 geckodriver 0.37.1。内置两种模型的 ZIP 与 schema 2 E2E 证据保存在仓库外临时目录；仓库 dist 最终为 remote 扩展及 bundled 用户脚本，均未纳入 Git。补齐报告后再次校验文档、格式与 diff。

未运行生产 Key 鉴权、远程 CI/CodeQL、精确最低浏览器版本或 Firefox Android 验收；未提交、推送、发布或部署。
