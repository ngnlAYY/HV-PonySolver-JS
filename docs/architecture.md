# Architecture

HV Pony Solver is a pnpm TypeScript monorepo with two runtime apps and one shared contract package.

## Apps

- `apps/userscript` runs in the browser as a generated userscript.
- `apps/model-worker` runs on Cloudflare Workers and serves model files from R2 after KV authorization.

## Shared Package

`packages/shared` contains cross-app contracts only: answer codes, model filename/path constants, access-decision types, and token validation.

The apps must not import from each other. Runtime-specific concerns stay in their owning app: DOM selectors and IndexedDB remain in `apps/userscript`; KV/R2 bindings remain in `apps/model-worker`.
