# Architecture

HV Pony Solver 是一个 pnpm TypeScript monorepo，由 2 个运行时应用与 1 个共享契约包组成。

## 边界一：`apps/userscript`

`apps/userscript` 是浏览器端 userscript 应用，负责：

- 页面内验证码检测与提交流程
- ONNX Runtime Web 推理调用
- 本地缓存与运行状态展示
- userscript 设置与本地持久化

该边界内只包含浏览器运行时逻辑，不承载 Cloudflare Worker/KV/R2 访问逻辑。

## 边界二：`apps/model-worker`

`apps/model-worker` 是 Cloudflare Worker 应用，负责：

- 对外暴露模型下载路径（`PUBLIC_MODEL_PATH`）
- 仅处理 `GET`/`HEAD` 请求
- 校验 `key` query 参数并查询 KV 授权
- 根据访问决策返回真实模型、decoy 模型或 403
- 按 Origin 策略返回 CORS 头

该边界内只包含 Worker 运行时逻辑，不承载 DOM、userscript 面板、浏览器本地存储逻辑。

## 边界三：`packages/shared`

`packages/shared` 是跨应用共享契约层，仅承载稳定且可复用的“协议内容”，例如：

- 模型路径/文件名常量
- 访问 token 校验规则
- 访问决策类型
- 答案编码等跨端语义常量

## 依赖约束（强约束）

- `apps/userscript` 与 `apps/model-worker` **不允许互相 import**。
- 所有跨应用共享契约必须放在 `packages/shared`。
- 运行时细节保留在各自应用内（浏览器细节留在 userscript，Worker 平台细节留在 model-worker）。

## 设计目标

这种边界划分保证：

1. 浏览器端与云端部署可独立演进。
2. 共享内容保持最小且稳定，降低耦合。
3. 任一应用内部重构不会直接破坏另一个应用的运行时实现。
