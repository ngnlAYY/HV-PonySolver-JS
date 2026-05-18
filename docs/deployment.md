# Deployment

## Userscript Artifact

Build locally or in CI:

```bash
pnpm --filter @hv-pony-solver/userscript build
```

Install or distribute:

```text
apps/userscript/dist/hv-pony-solver.user.js
```

Old artifact names are intentionally not generated.

## Model Worker

The Worker uses `apps/model-worker/wrangler.template.toml` as the versioned source of deployment config. The rendered `wrangler.toml` is local-only and ignored by git.

Required secrets for GitHub Actions deployment:

- `MODEL_KEYS_KV_NAMESPACE_ID`
- `MODEL_BUCKET_NAME`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Manual local render:

```bash
MODEL_KEYS_KV_NAMESPACE_ID=<kv-id> MODEL_BUCKET_NAME=<bucket-name> pnpm --filter @hv-pony-solver/model-worker render-config
```

Deploy:

```bash
pnpm --filter @hv-pony-solver/model-worker deploy
```
