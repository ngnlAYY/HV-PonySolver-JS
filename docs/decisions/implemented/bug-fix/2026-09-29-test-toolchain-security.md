# Agent Note: 同步测试工具链安全补丁并保留 undici 主版本边界

Status: implemented

## Problem

[同日 Web 与扩展审计](../../../audits/2026-09-29-web-extension-audit.md)保留了 4 项 moderate 依赖告警：Vitest 与 `@vitest/mocker` 4.1.10 对应 `GHSA-82fw-gwwq-j7x9`；jsdom 分支的 undici 8.10.0 和 Miniflare 分支的 undici 7.29.0 对应 `GHSA-3wwx-pv8p-q78v`。`audit:high` 退出 0 只说明未触发既定严重度门槛，不代表这些告警已修复。用户后续要求消除剩余问题。

Vitest 与 coverage 插件要求匹配的版本；Cloudflare 测试集成还通过 runner、snapshot 和 workerd 运行。单独覆盖 mocker 或把两条 undici 分支统一到一个主版本，会扩大兼容性风险。

## Decision

- 根包和五个工作区将 Vitest 最低版本同步为 `^4.1.11`；根包的 `@vitest/coverage-istanbul`、`@vitest/coverage-v8` 同步精确固定为 `4.1.11`。锁文件中的 Vitest 内部组件一并更新。
- `pnpm-workspace.yaml` 分别使用 `undici@7: '7.29.1'` 和 `undici@8: '8.10.2'`。精确覆盖仅选取已修复补丁，不顺带解析到更高 minor，也不跨 major 替换上游依赖。
- 通过 pnpm 重新解析并生成锁文件，不手改 integrity。复核差异只涉及 Vitest 组件、两条 undici 分支及相应 peer 上下文。
- 保持 Node.js 24.15.0、pnpm 12.3.0、Cloudflare 测试集成、Wrangler、jsdom、Vite、产品版本和模型/Runtime 身份不变。保留 7 天发布等待、trust policy、构建脚本允许列表、审计阈值与发布门禁，不添加漏洞忽略或供应链策略例外。

## Existing record audit

检索活跃决定中的依赖、Vitest、undici、漏洞和审计：[构建安全](2026-09-22-build-safety-and-reproducibility.md)部分重叠，沿用其定向 sharp 补丁及保留门禁的原则，不改历史结果；[有界 IO](2026-09-29-bounded-io-and-lifecycle.md)与 [MV3](2026-09-29-extension-mv3-boundaries.md)的“不升级依赖”限定上一轮源码修复，不阻止本轮补丁。无须替代的同主题 proposed/rejected 记录。

## Alternatives considered

- 只维持 high 阈值：无需变更依赖，但会继续保留已有修复版本的 moderate 告警，不能满足本次要求。
- 只更新 mocker 或锁文件：改动看似更小，但会割裂 Vitest 组件与精确匹配的 coverage 插件，或保留允许回到旧版本的清单下限。
- 使用宽范围 undici override 或全量升级：可吸收更多后续修复，但本次会同时带入无关 minor 或其他包变化，超出已定位问题的验证范围。
- 将 undici 统一为一个主版本：依赖树更少，但 jsdom 与 Miniflare 的上游兼容边界不同，不能用去重替代兼容性证据。

## Verification

重新执行冻结安装、完整依赖审计与 moderate/high/生产依赖审计，均报告未发现已知漏洞。先运行 Model Worker 定向测试，再运行 `mise exec -- pnpm check`，覆盖两个 coverage provider、所有工作区与根级测试、构建和静态门禁。用户脚本 E2E、content fixture、Chromium/Firefox remote load-only 与 packaged fixture 双浏览器回归及两个用户脚本包体 profile 均重新通过。实际版本、数量与证据边界见[补丁复核记录](../../../audits/2026-09-29-dependency-security-remediation.md)。

## Consequences

4 项已知告警消除，源码修复与发布边界不变。后续公告/上游升级须复核 undici override；Vitest 更新须同步 coverage 并验证 Cloudflare 集成。审计仅反映当次 registry 与依赖图，不证明无未知漏洞或替代 Node 内置组件、浏览器、第三方二进制审计。未用生产 Key，未运行最低浏览器版本、Android、远程 CI/CodeQL 或发布部署。
