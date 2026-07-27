# State Management（不适用）

Shared package 不拥有 runtime state、server cache 或 persistence。`MODEL_INTEGRITY` 等 exported constants 是 immutable contract，不是 mutable global store。

- Userscript 的 GM/IndexedDB/Worker state 由 `apps/userscript` 管理。
- Model Worker 的 KV/R2 request state 由 `apps/model-worker` 管理。
- Shared 函数只根据输入返回确定结果，不读取环境变量或 storage。

禁止在 shared 中增加 singleton cache、DOM state 或 Cloudflare binding。详见 [`../backend/quality-guidelines.md`](../backend/quality-guidelines.md)。
