# Contributing

## 推荐流程

1. 如果存在进行中的计划，先阅读 `docs/superpowers/plans/` 下的当前计划。
2. 一次只实现一个任务，并保持变更范围可复审、可回滚。
3. 运行任务内列出的 targeted verification command。
4. 交付前运行更宽的检查命令，并如实记录未运行或失败的验证。

## 常用命令

- Userscript only：`corepack pnpm check:userscript`
- Model Worker only：`corepack pnpm check:model-worker`
- Shared package only：`corepack pnpm check:shared`
- Fast repo gate：`corepack pnpm check:quick`
- Full repo gate：`corepack pnpm check`

## Commit 风格

使用 `<type>(scope): <summary>` 或 `<type>: <summary>`。

`summary` 使用中文，动词开头，不以标点结尾。
