# userscript 覆盖率提升

> 父任务：07-26-project-optimization-round2（R3）。轻量任务，PRD-only。
> **建议顺序**：在 07-26-deps-routine-upgrade 之后（vitest 版本稳定后再定门槛）。

## Goal

userscript 覆盖率门槛从 80/80/70/80 提升到 90/90/80/90（lines/functions/branches/statements），并补齐达标所需测试。

## Requirements

1. 先运行 `test:coverage` 取得当前真实覆盖率，识别与 90/90/80/90 的差距模块。
2. 按报告补测试；优先候选（codegraph 审计提示）：`model-downloader` 内部分支（createModelFetchInit、readModelResponse 各校验路径）、`onnx-worker-entry`、inference 相关未覆盖分支。
3. 更新 `apps/userscript/vitest.config.ts` thresholds 至 90/90/80/90。
4. 不得通过新增 coverage exclude 达标；确有不可测文件需逐条记录理由到本 PRD 的 Notes。
5. 新测试遵循现有 test/ 目录结构与命名（test/<模块目录>/<模块>.test.ts）。

## 验收标准

- [x] `corepack pnpm --filter @hv-pony-solver/userscript test:coverage` 在新门槛下通过
- [x] `corepack pnpm check:userscript` 全绿
- [x] vitest.config.ts thresholds = 90/90/80/90
- [x] 无新增 coverage exclude

## 验证命令

```bash
corepack pnpm --filter @hv-pony-solver/userscript test:coverage
corepack pnpm check:userscript
```

## Notes

- 基线（升级依赖后、补测前）：lines 94.14%、functions 95.74%、branches 83.70%、statements 93.88%。
- 最终：lines 94.29%、functions 95.86%、branches 83.97%、statements 94.04%。
- 新增 `onnx-worker-entry.test.ts`：覆盖 runtime 加载、session 复用、图像预处理、两类 ONNX 输出结构与 worker 错误协议。
- 扩充 `model-downloader.test.ts`：覆盖 storage 失败降级、非安全整数 content-length、无流式 body 时的大小校验。
- 27 个 Vitest 文件 / 237 tests + 59 个 Node tests 全部通过；无生产代码改动、无 coverage exclude。
- 独立 `trellis-check`：发现并修复 1 处格式问题，功能检查通过。
- Spec 更新评估：无需更新；本任务只测试既有可执行行为并提高质量门槛，没有新增或变更命令/API/数据/跨层协议。
