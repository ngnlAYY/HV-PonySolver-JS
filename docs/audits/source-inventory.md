# 源码与目录盘点

本页是 [2026-09-07 审计](2026-09-07-repository-audit.md)的范围明细，按目录列出全部自有源码、脚本和测试代码。数字来自新增本轮文档之前的工作区快照；长期维护说明不依赖这些数字。

## 统计口径

使用 `git ls-files --cached --others --exclude-standard -z` 枚举路径，去重并排除已经删除的文件。排除 `apps/userscript/vendor/`、`other/` 和本地工具状态；依赖、dist、coverage、模型、生成配置本身由忽略规则排除。

- 源码：`src/` 下的 `.ts`、`.tsx`、`.js`、`.mjs`，含源码目录中的 fixture hook。
- 测试：`test/`、`tests/`、`e2e/` 或文件名含 `.test.` 的 JS/TS 文件，包含 helper 和 setup。
- 非测试脚本：根或工作区 `scripts/` 下的 JS/TS/MJS/SH，排除前一类。
- 物理行数包括注释和空行；一行压缩代码不能与一行手写 TypeScript 等同评价。

共 369 个自有维护文件，其中下表代码类 323 个，另有 46 个文档、包/工具/工作流配置、HTML、fixture 数据和锁定依赖等辅助文件。文件数量不能当作实际执行的测试数量。

## `src` 全部领域目录

| 目录                                     | 文件 | 行    |
| ---------------------------------------- | ---- | ----- |
| `apps/extension/src/background`          | 9    | 870   |
| `apps/extension/src/content`             | 7    | 870   |
| `apps/extension/src/host`                | 14   | 829   |
| `apps/extension/src/offscreen`           | 3    | 344   |
| `apps/extension/src/options`             | 4    | 736   |
| `apps/extension/src/platform`            | 6    | 247   |
| `apps/extension/src/protocol`            | 4    | 646   |
| `apps/model-worker/src`                  | 10   | 1101  |
| `apps/userscript/src`                    | 1    | 13    |
| `apps/userscript/src/app`                | 2    | 57    |
| `apps/userscript/src/captcha`            | 6    | 141   |
| `apps/userscript/src/inference`          | 9    | 313   |
| `apps/userscript/src/model`              | 3    | 209   |
| `apps/userscript/src/persistence`        | 1    | 9     |
| `apps/userscript/src/status-panel`       | 2    | 138   |
| `apps/userscript/src/userscript`         | 4    | 300   |
| `packages/browser-core/src`              | 1    | 44    |
| `packages/browser-core/src/app`          | 2    | 316   |
| `packages/browser-core/src/captcha`      | 12   | 960   |
| `packages/browser-core/src/inference`    | 8    | 1490  |
| `packages/browser-core/src/model`        | 12   | 1288  |
| `packages/browser-core/src/persistence`  | 3    | 359   |
| `packages/browser-core/src/platform`     | 3    | 105   |
| `packages/browser-core/src/status-panel` | 4    | 542   |
| `packages/browser-core/src/utils`        | 5    | 165   |
| `packages/shared/src`                    | 7    | 95    |
| 合计                                     | 142  | 12187 |

模块关系和对应入口见[全局架构](../architecture/overview.md)、[浏览器核心](../architecture/browser-runtime.md)、[扩展](../architecture/extension-runtime.md)和[服务端](../architecture/model-service.md)。

## 非测试脚本

| 目录                             | 文件 | 行    |
| -------------------------------- | ---- | ----- |
| `apps/extension/scripts`         | 19   | 4845  |
| `apps/extension/scripts/browser` | 3    | 265   |
| `apps/extension/scripts/build`   | 6    | 895   |
| `apps/model-worker/scripts`      | 5    | 774   |
| `apps/userscript/scripts`        | 5    | 607   |
| `scripts`                        | 11   | 1443  |
| `scripts/docs-drift`             | 9    | 1796  |
| `scripts/lib`                    | 4    | 74    |
| 合计                             | 62   | 10699 |

## 测试与辅助代码

| 目录                                      | 文件 | 行    |
| ----------------------------------------- | ---- | ----- |
| `apps/extension/scripts`                  | 11   | 2235  |
| `apps/extension/test`                     | 2    | 42    |
| `apps/extension/test/background`          | 3    | 1812  |
| `apps/extension/test/content`             | 5    | 1283  |
| `apps/extension/test/host`                | 7    | 1349  |
| `apps/extension/test/offscreen`           | 1    | 355   |
| `apps/extension/test/options`             | 5    | 913   |
| `apps/extension/test/platform`            | 4    | 257   |
| `apps/extension/test/protocol`            | 3    | 487   |
| `apps/model-worker/scripts`               | 2    | 901   |
| `apps/model-worker/test`                  | 5    | 1988  |
| `apps/model-worker/test/helpers`          | 1    | 364   |
| `apps/userscript/scripts`                 | 4    | 613   |
| `apps/userscript/test`                    | 2    | 74    |
| `apps/userscript/test/app`                | 2    | 676   |
| `apps/userscript/test/captcha`            | 4    | 785   |
| `apps/userscript/test/e2e`                | 1    | 141   |
| `apps/userscript/test/helpers`            | 1    | 16    |
| `apps/userscript/test/inference`          | 5    | 905   |
| `apps/userscript/test/model`              | 2    | 898   |
| `apps/userscript/test/persistence`        | 1    | 111   |
| `apps/userscript/test/status-panel`       | 2    | 443   |
| `apps/userscript/test/userscript`         | 2    | 539   |
| `packages/browser-core/test`              | 1    | 34    |
| `packages/browser-core/test/app`          | 1    | 509   |
| `packages/browser-core/test/captcha`      | 5    | 1620  |
| `packages/browser-core/test/helpers`      | 1    | 16    |
| `packages/browser-core/test/inference`    | 6    | 1810  |
| `packages/browser-core/test/model`        | 6    | 2182  |
| `packages/browser-core/test/persistence`  | 1    | 260   |
| `packages/browser-core/test/platform`     | 2    | 122   |
| `packages/browser-core/test/status-panel` | 2    | 352   |
| `packages/browser-core/test/utils`        | 2    | 224   |
| `packages/shared/test`                    | 3    | 132   |
| `scripts`                                 | 13   | 3006  |
| `scripts/docs-drift`                      | 1    | 41    |
| 合计                                      | 119  | 27495 |

## 配置、文档和非源码目录

根配置核对了 `mise.toml`、`package.json`、pnpm workspace/lock、ESLint、Prettier、TypeScript、Vitest 和 `.gitignore`。工作区核对了各包清单、TS/Vitest/Playwright 配置、扩展 HTML/fixture 及 Worker 模板/渲染入口；CI 核对了仓库实际维护的两个 workflow。

原有文档是根 README、AGENTS，以及 `docs/browser-extension.md`、`model-cache-strategy.md`、`model-worker-ops.md`、`onnx-runtime.md`。本轮新增内容在[文档导航](../README.md)中单独归组。

`model/` 是固定本地输入，`other/` 是 Runtime 输出，`config/`、`dist/`、`coverage/`、`.wrangler/` 和索引属于生成物或工具状态。它们未作为平铺源码的重构目标，未读取其中的生产秘密来完成审计。第三方 Runtime 的许可证和压缩产物也不按手写代码风格检查。

## 复查文件列表

在仓库根目录运行以下只读命令，可以列出当前自有维护文件。它反映运行时的工作区状态，因此本轮新增文档也会出现在结果中，数量不应再与审计前快照强行相等：

```bash
python3 - <<'PY'
from pathlib import Path
from subprocess import check_output

excluded = ('apps/userscript/vendor/', 'other/', '.omx/', '.codegraph/')
paths = check_output([
    'git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'
]).decode().split('\0')
for name in sorted(set(paths)):
    if name and not name.startswith(excluded) and Path(name).is_file():
        print(name)
PY
```

这条命令只用于清点路径，不读取文件内容或凭据，也不代表完成了行为审查。审计结论和实际运行的验证仍以[报告](2026-09-07-repository-audit.md#验证记录)为准。
