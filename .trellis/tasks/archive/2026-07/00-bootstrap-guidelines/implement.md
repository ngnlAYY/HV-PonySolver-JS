# Bootstrap Guidelines：执行计划

## Stage 1：提取真实约定

- [x] 从 Userscript、Model Worker、Shared 三个 workspace 并行提取重复模式。
- [x] 读取仓库现有约定文档与工具配置。
- [x] 每个适用主题收集至少 2 个真实源码/测试示例。
- [x] 标记无对应运行时概念的层，不杜撰 React、ORM、数据库或 UI。

## Stage 2：填写 Model Worker specs

- [x] 完成 backend index、目录、KV/R2 persistence、错误、日志和质量规范。
- [x] 加入 Bearer/CORS/no-store、env normalization、Wrangler render guard、post-deploy checker 规则。
- [x] 将 frontend 文件改为明确 N/A，并指向 backend。

## Stage 3：填写 Userscript specs

- [x] 完成 frontend index 与目录规范。
- [x] 把 component/hook/state 模板改写为 vanilla DOM、side-effect lifecycle、GM/IndexedDB/Worker 真实约定。
- [x] 完成 type safety。
- [x] 保留并整合既有 bundle budget 与 E2E CI guardrails，补齐完整质量/review 规则。

## Stage 4：填写 Shared specs

- [x] 完成 backend index、纯契约目录、persistence ownership、错误、日志和质量规范。
- [x] 加入 model manifest、token normalization、immutable types、dependency direction 和测试边界。
- [x] 将 frontend 文件改为明确 N/A，并指向 backend。

## Stage 5：清理模板与验证引用

- [x] 所有 index 状态改为 Completed 或 Not applicable。
- [x] 移除 `To fill`、`(To be filled by the team)`、模板 HTML comments 和不适用的泛化指令。
- [x] 验证 Markdown 相对链接和引用的 repo 文件存在。
- [x] 确认每个适用 guideline 含真实例子、forbidden/common mistakes 和验证命令。
- [x] 更新 PRD checklist。
- [x] 在 `.trellis/config.yaml` 映射 userscript、model-worker、shared 三个 workspace，并验证 `get_context.py --mode packages`。

## Stage 6：质量检查

```bash
corepack pnpm exec prettier --check .trellis/spec .trellis/tasks/00-bootstrap-guidelines
corepack pnpm docs:check
corepack pnpm check
```

- [x] 格式、docs drift 与完整仓库检查通过。
- [x] 独立审查规范是否描述现实而非理想；9 项确定问题已修复，复核无剩余阻塞项。
- [x] 扫描确认没有真实 Key、credential、私钥或不应记录的生产资源 ID。

## Stage 7：提交与归档

- [x] 仅纳入 bootstrap task、`.trellis/spec/` 及 Trellis 运行所需 scaffold；不混入未知文件。
- [x] 按规范内容与任务记录拆分提交。
- [x] 直接推送到远程 `main`（用户已授权本轮无需 PR）。
- [x] 归档 `00-bootstrap-guidelines`；session journal按 finish-work流程另行记录。

## Rollback

- 若某条规范找不到至少两个真实例子，删除或降级为明确 N/A，而不是保留推测。
- 若 index/link 验证失败，修复引用；不通过删除质量检查规避。
- 若规范与现有 CI/source 冲突，以当前已验证代码与测试为准，记录已知 tech debt，不擅自改产品代码来迎合文档。
