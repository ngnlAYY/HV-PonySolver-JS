# Model Worker

The model worker app lives in `apps/model-worker` and deploys to Cloudflare Workers.

## Responsibilities

- Accept model download requests for the configured public model path.
- Validate `key` query parameters as 64-character hexadecimal model access tokens.
- Check authorized keys in KV.
- Return the real R2 model for authorized keys.
- Return the decoy model by default for missing, malformed, or unauthorized keys.
- Return `403 Forbidden` for invalid access when `INVALID_KEY_MODE=error`.

## Local Test Config

```bash
MODEL_KEYS_KV_NAMESPACE_ID=test-kv MODEL_BUCKET_NAME=test-bucket pnpm --filter @hv-pony-solver/model-worker render-config
pnpm --filter @hv-pony-solver/model-worker test
```
