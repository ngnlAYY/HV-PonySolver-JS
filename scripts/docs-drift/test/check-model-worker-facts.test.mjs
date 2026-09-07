import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { readFile, runCheck, withFixture, writeFile } from './fixtures.mjs'

test('fails clearly when Model Worker source allowed methods drift from README', async () => {
  await withFixture(async (fixtureRoot) => {
    const routerPath = join(fixtureRoot, 'apps/model-worker/src/request-router.ts')
    const routerSource = await readFile(routerPath, 'utf8')
    assert.ok(routerSource.includes("const ALLOWED_METHODS = 'GET, HEAD, OPTIONS'"))
    assert.ok(routerSource.includes("const QUOTA_ALLOWED_METHODS = 'GET, POST, OPTIONS'"))
    await writeFile(
      routerPath,
      routerSource
        .replace("const ALLOWED_METHODS = 'GET, HEAD, OPTIONS'", "const ALLOWED_METHODS = 'GET, HEAD'")
        .replace("const QUOTA_ALLOWED_METHODS = 'GET, POST, OPTIONS'", "const QUOTA_ALLOWED_METHODS = 'GET, OPTIONS'"),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*405 docs must mention Allow: GET, HEAD/s)
    assert.match(result.stderr, /README.md.*model OPTIONS docs must mention Access-Control-Allow-Methods: GET, HEAD/s)
    assert.match(
      result.stderr,
      /README.md.*quota OPTIONS docs must mention Access-Control-Allow-Methods: GET, OPTIONS/s,
    )
    assert.match(result.stderr, /README.md.*runtime OPTIONS docs must mention Access-Control-Allow-Methods: GET, HEAD/s)
  })
})

test('fails clearly when Model Worker source auth and response facts drift from README', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const responsePath = join(fixtureRoot, 'apps/model-worker/src/model-response.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    const responseSource = await readFile(responsePath, 'utf8')
    assert.ok(accessSource.includes("request.headers.get('authorization')"))
    assert.ok(accessSource.includes('^Bearer\\s+'))
    assert.ok(responseSource.includes("const CACHE_CONTROL = 'no-store'"))
    assert.ok(responseSource.includes('textResponse(request, INTERNAL_ERROR_MESSAGE, 500'))
    await writeFile(
      accessPath,
      accessSource
        .replace("request.headers.get('authorization')", "request.headers.get('x-model-token')")
        .replace('^Bearer\\s+', '^Token\\s+'),
    )
    await writeFile(
      responsePath,
      responseSource
        .replace("const CACHE_CONTROL = 'no-store'", "const CACHE_CONTROL = 'private, no-cache'")
        .replace(
          'textResponse(request, INTERNAL_ERROR_MESSAGE, 500',
          'textResponse(request, INTERNAL_ERROR_MESSAGE, 404',
        ),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
    assert.match(result.stderr, /README.md.*authorized real-model row must mention Cache-Control: private, no-cache/s)
    assert.match(result.stderr, /README.md.*selected R2 object missing docs must mention 404 Internal Server Error/s)
  })
})

test('fails clearly when Model Worker source string facts drift is masked by regex literals', async () => {
  await withFixture(async (fixtureRoot) => {
    const routerPath = join(fixtureRoot, 'apps/model-worker/src/request-router.ts')
    const responsePath = join(fixtureRoot, 'apps/model-worker/src/model-response.ts')
    const routerSource = await readFile(routerPath, 'utf8')
    const responseSource = await readFile(responsePath, 'utf8')
    await writeFile(
      routerPath,
      `/const ALLOWED_METHODS = 'GET, HEAD, OPTIONS'/
/const QUOTA_ALLOWED_METHODS = 'GET, POST, OPTIONS'/
${routerSource
  .replace("const ALLOWED_METHODS = 'GET, HEAD, OPTIONS'", "const ALLOWED_METHODS = 'GET, HEAD'")
  .replace("const QUOTA_ALLOWED_METHODS = 'GET, POST, OPTIONS'", "const QUOTA_ALLOWED_METHODS = 'GET, OPTIONS'")}`,
    )
    await writeFile(
      responsePath,
      `/const CACHE_CONTROL = 'no-store'/
/if (object === null) { return textResponse(request, INTERNAL_ERROR_MESSAGE, 500) }/
${responseSource
  .replace("const CACHE_CONTROL = 'no-store'", "const CACHE_CONTROL = 'private, no-cache'")
  .replace('textResponse(request, INTERNAL_ERROR_MESSAGE, 500', 'textResponse(request, INTERNAL_ERROR_MESSAGE, 404')}`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*405 docs must mention Allow: GET, HEAD/s)
    assert.match(result.stderr, /README.md.*model OPTIONS docs must mention Access-Control-Allow-Methods: GET, HEAD/s)
    assert.match(
      result.stderr,
      /README.md.*quota OPTIONS docs must mention Access-Control-Allow-Methods: GET, OPTIONS/s,
    )
    assert.match(result.stderr, /README.md.*authorized real-model row must mention Cache-Control: private, no-cache/s)
    assert.match(result.stderr, /README.md.*selected R2 object missing docs must mention 404 Internal Server Error/s)
  })
})

test('fails clearly when Model Worker string facts use runtime expressions', async () => {
  await withFixture(async (fixtureRoot) => {
    const routerPath = join(fixtureRoot, 'apps/model-worker/src/request-router.ts')
    const responsePath = join(fixtureRoot, 'apps/model-worker/src/model-response.ts')
    const routerSource = await readFile(routerPath, 'utf8')
    const responseSource = await readFile(responsePath, 'utf8')
    await writeFile(
      routerPath,
      routerSource.replace(
        "const MODEL_ALLOWED_HEADERS = 'Authorization'",
        "const MODEL_ALLOWED_HEADERS = 'Authorization'.toLowerCase()",
      ),
    )
    await writeFile(
      responsePath,
      responseSource.replace(
        "const CACHE_CONTROL = 'no-store'",
        "const CACHE_CONTROL = 'no-store' + ', max-age=86400'",
      ),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-response\.ts.*CACHE_CONTROL.*string literal/s)
    assert.match(result.stderr, /apps\/model-worker\/src\/request-router\.ts.*MODEL_ALLOWED_HEADERS.*string literal/s)
  })
})

test('accepts Model Worker string facts with TypeScript-only annotations', async () => {
  await withFixture(async (fixtureRoot) => {
    const routerPath = join(fixtureRoot, 'apps/model-worker/src/request-router.ts')
    const responsePath = join(fixtureRoot, 'apps/model-worker/src/model-response.ts')
    const routerSource = await readFile(routerPath, 'utf8')
    const responseSource = await readFile(responsePath, 'utf8')
    await writeFile(
      routerPath,
      routerSource
        .replace(
          "const ALLOWED_METHODS = 'GET, HEAD, OPTIONS'",
          "const ALLOWED_METHODS: string = 'GET, HEAD, OPTIONS' as const",
        )
        .replace(
          "const MODEL_ALLOWED_HEADERS = 'Authorization'",
          "const MODEL_ALLOWED_HEADERS: string = 'Authorization' as const",
        ),
    )
    await writeFile(
      responsePath,
      responseSource.replace("const CACHE_CONTROL = 'no-store'", "const CACHE_CONTROL: string = 'no-store' as const"),
    )

    const result = await runCheck(fixtureRoot)
    assert.equal(result.exitCode, 0, result.stderr)
  })
})

test('accepts Model Worker string facts with combined TypeScript-only suffixes', async () => {
  await withFixture(async (fixtureRoot) => {
    const routerPath = join(fixtureRoot, 'apps/model-worker/src/request-router.ts')
    const routerSource = await readFile(routerPath, 'utf8')
    await writeFile(
      routerPath,
      routerSource
        .replace(
          "const ALLOWED_METHODS = 'GET, HEAD, OPTIONS'",
          "const ALLOWED_METHODS = 'GET, HEAD, OPTIONS' as const satisfies string",
        )
        .replace(
          "const MODEL_ALLOWED_HEADERS = 'Authorization'",
          "const MODEL_ALLOWED_HEADERS = 'Authorization' as const satisfies string",
        ),
    )

    const result = await runCheck(fixtureRoot)
    assert.equal(result.exitCode, 0, result.stderr)
  })
})

test('fails clearly when Model Worker response header use-sites bypass source facts', async () => {
  await withFixture(async (fixtureRoot) => {
    const routerPath = join(fixtureRoot, 'apps/model-worker/src/request-router.ts')
    const responsePath = join(fixtureRoot, 'apps/model-worker/src/model-response.ts')
    const routerSource = await readFile(routerPath, 'utf8')
    const responseSource = await readFile(responsePath, 'utf8')
    await writeFile(
      routerPath,
      routerSource
        .replace('allowMethods: isQuota ? QUOTA_ALLOWED_METHODS : ALLOWED_METHODS', "allowMethods: 'GET, HEAD'")
        .replace(
          'allowHeaders: isQuota ? QUOTA_ALLOWED_HEADERS : MODEL_ALLOWED_HEADERS',
          "allowHeaders: 'X-Model-Token'",
        ),
    )
    await writeFile(
      responsePath,
      responseSource
        .replace(
          "headers.set('access-control-allow-headers', policy.allowHeaders)",
          "headers.set('access-control-allow-headers', 'X-Model-Token')",
        )
        .replace("'access-control-allow-methods': policy.allowMethods", "'access-control-allow-methods': 'GET, HEAD'")
        .replaceAll("'cache-control': CACHE_CONTROL", "'cache-control': 'private, no-cache'"),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/request-router\.ts.*route-specific preflight methods/s)
    assert.match(result.stderr, /apps\/model-worker\/src\/request-router\.ts.*route-specific preflight headers/s)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-response\.ts.*policy\.allowHeaders/s)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-response\.ts.*policy\.allowMethods/s)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-response\.ts.*CACHE_CONTROL/s)
  })
})

test('fails clearly when Model Worker response header use-site drift is masked by regex decoys', async () => {
  await withFixture(async (fixtureRoot) => {
    const responsePath = join(fixtureRoot, 'apps/model-worker/src/model-response.ts')
    const responseSource = await readFile(responsePath, 'utf8')
    await writeFile(
      responsePath,
      `/headers\\.set\\('access-control-allow-headers', policy\\.allowHeaders\\)/
/'access-control-allow-methods': policy\\.allowMethods/
${responseSource
  .replace(
    "headers.set('access-control-allow-headers', policy.allowHeaders)",
    "headers.set('access-control-allow-headers', 'X-Model-Token')",
  )
  .replace("'access-control-allow-methods': policy.allowMethods", "'access-control-allow-methods': 'GET, HEAD'")}`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-response\.ts.*policy\.allowHeaders/s)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-response\.ts.*policy\.allowMethods/s)
  })
})

test('fails clearly when Model Worker response drift is masked by an earlier nested same-name function', async () => {
  await withFixture(async (fixtureRoot) => {
    const responsePath = join(fixtureRoot, 'apps/model-worker/src/model-response.ts')
    const responseSource = await readFile(responsePath, 'utf8')
    const nestedDecoy = `function decoyFunctionScope() {
  function preflightResponse(request: Request, policy: { allowHeaders: string; allowMethods: string }) {
    const headers = new Headers({
      'access-control-allow-methods': policy.allowMethods,
      'cache-control': CACHE_CONTROL,
    })
    headers.set('access-control-allow-headers', policy.allowHeaders)
    return headers
  }
}

`
    await writeFile(
      responsePath,
      nestedDecoy +
        responseSource
          .replace(
            "headers.set('access-control-allow-headers', policy.allowHeaders)",
            "headers.set('access-control-allow-headers', 'X-Model-Token')",
          )
          .replace(
            "'access-control-allow-methods': policy.allowMethods",
            "'access-control-allow-methods': 'GET, HEAD'",
          ),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-response\.ts.*policy\.allowHeaders/s)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-response\.ts.*policy\.allowMethods/s)
  })
})

test('fails clearly when selected R2 miss status is masked by an earlier decoy branch', async () => {
  await withFixture(async (fixtureRoot) => {
    const responsePath = join(fixtureRoot, 'apps/model-worker/src/model-response.ts')
    const responseSource = await readFile(responsePath, 'utf8')
    await writeFile(
      responsePath,
      responseSource
        .replace(
          'textResponse(request, INTERNAL_ERROR_MESSAGE, 500',
          'textResponse(request, INTERNAL_ERROR_MESSAGE, 404',
        )
        .replace(
          'export async function createModelResponse',
          `function decoySelectedObjectMissingStatus(object: unknown, request: Request): Response | null {
  if (object === null) { return textResponse(request, INTERNAL_ERROR_MESSAGE, 500) }
  return null
}

export async function createModelResponse`,
        ),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*selected R2 object missing docs must mention 404 Internal Server Error/s)
  })
})

test('accepts selected R2 miss status with equivalent null-guard shape', async () => {
  await withFixture(async (fixtureRoot) => {
    const responsePath = join(fixtureRoot, 'apps/model-worker/src/model-response.ts')
    const responseSource = await readFile(responsePath, 'utf8')
    await writeFile(
      responsePath,
      responseSource.replace(
        `if (object === null) {
    return textResponse(request, INTERNAL_ERROR_MESSAGE, 500, { 'content-type': 'text/plain;charset=UTF-8' })
  }`,
        `if (null === object) return textResponse(
    request,
    INTERNAL_ERROR_MESSAGE,
    500,
    { 'content-type': 'text/plain;charset=UTF-8' },
  )`,
      ),
    )

    const result = await runCheck(fixtureRoot)
    assert.equal(result.exitCode, 0, result.stderr)
  })
})

test('fails clearly when selected R2 miss status is masked by nested dead decoy after bucket get', async () => {
  await withFixture(async (fixtureRoot) => {
    const responsePath = join(fixtureRoot, 'apps/model-worker/src/model-response.ts')
    const responseSource = await readFile(responsePath, 'utf8')
    await writeFile(
      responsePath,
      responseSource
        .replace(
          'textResponse(request, INTERNAL_ERROR_MESSAGE, 500',
          'textResponse(request, INTERNAL_ERROR_MESSAGE, 404',
        )
        .replace(
          'const object = await env.modelBucket.get(objectKey)',
          'const object = await env.modelBucket.get(objectKey)\n  if (false) { if (object === null) { return textResponse(request, INTERNAL_ERROR_MESSAGE, 500) } }',
        ),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*selected R2 object missing docs must mention 404 Internal Server Error/s)
  })
})

test('fails clearly when Model Worker source auth drift is masked by comments', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    await writeFile(
      accessPath,
      `${accessSource
        .replace("request.headers.get('authorization')", "request.headers.get('x-model-token')")
        .replace('^Bearer\\s+', '^Token\\s+')}
// decoy: request.headers.get('authorization') and /^Bearer\\s+/
`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
  })
})

test('fails clearly when Model Worker source auth drift is masked by strings', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    await writeFile(
      accessPath,
      `${accessSource
        .replace("request.headers.get('authorization')", "request.headers.get('x-model-token')")
        .replace('^Bearer\\s+', '^Token\\s+')}
const decoy = "request.headers.get('authorization') /^Bearer\\\\s+/"
const templateDecoy = \`request.headers.get('authorization') /^Bearer\\\\s+/\`
`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
  })
})

test('fails clearly when Model Worker source auth drift is masked by regex literals', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    await writeFile(
      accessPath,
      `${accessSource
        .replace("request.headers.get('authorization')", "request.headers.get('x-model-token')")
        .replace('^Bearer\\s+', '^Token\\s+')}
/request.headers.get('authorization')/
/^Bearer\\s+/
`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
  })
})

test('fails clearly when Bearer authorization pattern has no token capture group', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    await writeFile(accessPath, accessSource.replace('([^\\s]+)', '(?:[^\\s]+)'))

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
  })
})

test('fails clearly when Authorization header read is only a dead-code decoy', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    await writeFile(
      accessPath,
      `${accessSource.replace("request.headers.get('authorization')", "request.headers.get('x-model-token')")}
if (false) {
  request.headers.get('authorization')
}
`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
  })
})

test('fails clearly when Bearer exec is only a dead-code decoy', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    await writeFile(
      accessPath,
      `${accessSource.replace('BEARER_AUTHORIZATION_PATTERN.exec(authorization.trim())', '/^Token\\s+([^\\s]+)$/i.exec(authorization.trim())')}
if (false) {
  BEARER_AUTHORIZATION_PATTERN.exec('Bearer decoy')
}
`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
  })
})

test('fails clearly when stale top-level Bearer pattern is unused by token parser', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    await writeFile(
      accessPath,
      `${accessSource
        .replace(
          'const BEARER_AUTHORIZATION_PATTERN = /^Bearer\\s+([^\\s]+)$/i',
          'const BEARER_AUTHORIZATION_PATTERN = /^Bearer\\s+([^\\s]+)$/i\nconst TOKEN_AUTHORIZATION_PATTERN = /^Token\\s+([^\\s]+)$/i',
        )
        .replace(
          'BEARER_AUTHORIZATION_PATTERN.exec(authorization.trim())',
          'TOKEN_AUTHORIZATION_PATTERN.exec(authorization.trim())',
        )}
if (false) {
  BEARER_AUTHORIZATION_PATTERN.exec('Bearer decoy')
}
`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
  })
})

test('fails clearly when Bearer token parser is unused by model access selection', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    assert.ok(accessSource.includes('const lookupKeys = getModelAccessTokenLookupKeys(requestToken)'))
    await writeFile(
      accessPath,
      accessSource.replace(
        'const lookupKeys = getModelAccessTokenLookupKeys(requestToken)',
        "const lookupKeys = getModelAccessTokenLookupKeys(request.headers.get('x-model-token'))",
      ),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
  })
})

test('fails clearly when the Authorization header is parsed more than once per request', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    assert.ok(accessSource.includes('const canonicalToken = normalizeModelAccessToken(requestToken)'))
    await writeFile(
      accessPath,
      accessSource.replace(
        'const canonicalToken = normalizeModelAccessToken(requestToken)',
        'const canonicalToken = normalizeModelAccessToken(getRequestAccessToken(request))',
      ),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
  })
})

test('fails clearly when Bearer authorization pattern drift is masked by regex literal const decoy', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    await writeFile(
      accessPath,
      `/[const BEARER_AUTHORIZATION_PATTERN = /^Bearer\\s+]/
${accessSource.replace('^Bearer\\s+', '^Token\\s+')}`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
  })
})

test('fails clearly when Bearer authorization pattern drift is masked by inner const decoy', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    await writeFile(
      accessPath,
      `${accessSource.replace('^Bearer\\s+', '^Token\\s+')}
if (false) {
  const BEARER_AUTHORIZATION_PATTERN = /^Bearer\\s+([^\\s]+)$/i
  BEARER_AUTHORIZATION_PATTERN.exec('Bearer decoy')
}
`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /apps\/model-worker\/src\/model-access\.ts.*Authorization: Bearer/s)
  })
})

test('accepts Model Worker source auth with comment and string decoys', async () => {
  await withFixture(async (fixtureRoot) => {
    const accessPath = join(fixtureRoot, 'apps/model-worker/src/model-access.ts')
    const accessSource = await readFile(accessPath, 'utf8')
    await writeFile(
      accessPath,
      `${accessSource}
// decoy: request.headers.get('x-model-token') and /^Token\\s+/
const decoy = "request.headers.get('x-model-token') /^Token\\\\s+/"
const templateDecoy = \`request.headers.get('x-model-token') /^Token\\\\s+/\`
`,
    )

    const result = await runCheck(fixtureRoot)
    assert.equal(result.exitCode, 0, result.stderr)
  })
})
