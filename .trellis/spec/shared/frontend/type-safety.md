# Type Safety（不适用）

Shared 的 TypeScript 契约本身适用于所有 runtime，不存在单独 frontend type layer。

真实类型来源：

- `packages/shared/src/answer.ts`：`ANSWER_CODES` tuple 与 `AnswerCode` union。
- `packages/shared/src/model.ts`：canonical model constants。
- `packages/shared/src/token.ts`：token type guard、normalization 与 readonly lookup keys。

使用 [`../backend/quality-guidelines.md`](../backend/quality-guidelines.md)；不要创建 framework props、DOM event 或 browser-only 类型。
