# 2026-09-29 测试依赖安全补丁复核

本记录接续[同日 Web 与扩展审计](2026-09-29-web-extension-audit.md)中的 4 项 moderate 告警。只记录后续依赖修复及重新执行的证据；不把此前源码审计结果改写为当时已无告警。

## 修复范围

| 依赖                                           | 原解析版本 | 修复后解析版本 | 覆盖范围                                           |
| ---------------------------------------------- | ---------- | -------------- | -------------------------------------------------- |
| vitest、@vitest/mocker                         | 4.1.10     | 4.1.11         | 根包、五个工作区及 Cloudflare runner/snapshot peer |
| @vitest/coverage-istanbul、@vitest/coverage-v8 | 4.1.10     | 4.1.11         | 保持与 Vitest 精确版本一致                         |
| undici（Miniflare）                            | 7.29.0     | 7.29.1         | Cloudflare Worker 本地测试与 Wrangler 工具链       |
| undici（jsdom）                                | 8.10.0     | 8.10.2         | DOM 测试及使用 jsdom 的构建检查                    |

修复版本对照上游公告：`https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9` 与 `https://github.com/nodejs/undici/security/advisories/GHSA-3wwx-pv8p-q78v`。两个公告对应此前四项报告，不能将报告数解释为四个独立漏洞或四条已证实的生产攻击路径。

六份包清单同步 Vitest 下限，根 coverage 插件保持精确版本；workspace 按 major 精确覆盖 undici。pnpm 生成的锁文件只改变这些依赖和 peer 上下文，没有全量升级。Node/pnpm、Cloudflare pool、Miniflare、Wrangler、jsdom、Vite、用户脚本/扩展版本及 ORT 资产保持原值。没有忽略 advisory、降低审计门槛或放宽供应链策略。取舍见[测试工具链安全决定](../decisions/implemented/bug-fix/2026-09-29-test-toolchain-security.md)。

## 审计与安装

以下命令在补丁落入锁文件后重新执行：

- `mise exec -- pnpm install --frozen-lockfile`：通过，锁文件与六份包清单一致。
- `mise exec -- pnpm list -r vitest @vitest/coverage-v8 @vitest/coverage-istanbul`：全部实际解析为 4.1.11。
- `mise exec -- pnpm why -r undici`：仅有 7.29.1 与 8.10.2，分别属于 Miniflare 与 jsdom 分支。
- `mise exec -- pnpm audit`、`mise exec -- pnpm audit --audit-level moderate`、`mise exec -- pnpm audit:high`：均退出 0，报告 `No known vulnerabilities found`，不再只是 high 门槛放行。
- `mise exec -- pnpm audit --prod --audit-level moderate`：退出 0，报告未发现已知漏洞；只代表 package manifest 定义的生产依赖图。

## 重新验证

| 验证                      | 结果与范围                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Model Worker 定向测试     | 128 项 Vitest、56 项 Node 测试通过；验证 Vitest 4.1.11 与现有 Cloudflare/workerd 集成                         |
| `mise exec -- pnpm check` | 格式、lint、类型、全部测试、文档、架构、危险调用、扩展打包、默认包体、coverage 和全仓库构建通过               |
| 工作区 Vitest             | shared 15、Model Worker 128、browser-core 507、userscript 234、extension 296 项通过；未重复计数 coverage 重跑 |
| Node 测试                 | Worker 脚本 56、用户脚本构建 28、扩展脚本 174、根级 315 项通过                                                |
| 用户脚本 Chromium E2E     | 3 项通过：本地识别 fixture、并发历史、外置 Worker 原生 JSEP MJS 导入                                          |
| Chromium content fixture  | 自动/手动答题、单次提交、历史、DOM 失效与 BFCache 恢复通过                                                    |
| remote load-only          | Chromium 154.0.8037.57、Firefox 153.0 加载与设置页通过；未鉴权下载模型                                        |
| packaged fixture          | 同一桌面双浏览器通过；包含 oracle、后台重启/Offscreen 生命周期、取消、重复推理及重建                          |
| 用户脚本双 profile        | 未压缩 external 203390 B / 262144 B；未压缩 bundled 285047 B / 1048576 B，预算均通过                          |
| Actions 与差异            | `assert-pinned-actions.mjs`、`git diff --check` 通过                                                          |

Worker 配置仅临时渲染 `test-kv`、`test-bucket`；原生成配置在验证后按字节恢复。结束时重建默认 external 用户脚本和 remote 扩展，避免留下默认 fixture 包。既有源码改动均保留，没有 commit、push、发布或部署。

## 证据边界

- 审计清零仅覆盖本次 registry 返回的已知依赖公告，不是无漏洞证明；undici npm override 不会修改 Node 内置实现。
- 未使用生产 Key，未完成 canonical/受保护远程模型验证；本地 fixture 不证明真实模型准确率或额度链路。
- 未运行 Chromium 116、Firefox Desktop 140、Firefox Android 142、远程 GitHub Actions/CodeQL；这些边界不能由当前桌面通过代替。
- 后续升级应继续保持 Vitest/coverage 对齐并检查两个 undici major；精确 override 不应长期阻挡新的安全补丁。
