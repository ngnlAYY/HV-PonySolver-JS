import assert from 'node:assert/strict'
import test from 'node:test'
import { URL } from 'node:url'

import {
  ALLOWED_ORIGINS,
  DEFAULT_ATTEMPTS,
  DEFAULT_RETRY_DELAY_MS,
  checkDeploymentContract,
  createProbeUrl,
  runCli,
} from './check-deployment-contract.mjs'

const MODEL_URL = 'https://models.ngnl.host/yolo26n-640.onnx'
const ORT_MODEL_URL = 'https://models.ngnl.host/yolo26n-640.ort'
const RUNTIME_WASM_URL = 'https://models.ngnl.host/runtime/ort-wasm-simd-hash.wasm'
const RUNTIME_WASM_BYTE_LENGTH = 1_267_937
const PROBE_ID = 'run 123/attempt-2'

function contractHeaders(origin, extra = {}) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'OPTIONS, GET, HEAD',
    'access-control-allow-headers': 'Authorization',
    'cache-control': 'no-store',
    vary: 'Accept-Encoding, Origin',
    ...extra,
  }
}

function runtimeHeaders(extra = {}) {
  return {
    'access-control-allow-origin': '*',
    'cache-control': 'public, max-age=31536000, immutable',
    'content-type': 'application/wasm',
    'content-length': String(RUNTIME_WASM_BYTE_LENGTH),
    etag: '"runtime-etag"',
    'x-content-type-options': 'nosniff',
    ...extra,
  }
}

function fixtureHeaders(headers) {
  const normalized = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value)]))
  return {
    get(name) {
      return normalized.get(name.toLowerCase()) ?? null
    },
    has(name) {
      return normalized.has(name.toLowerCase())
    },
  }
}

function fixtureResponse(status, headers) {
  return {
    status,
    headers: fixtureHeaders(headers),
    get body() {
      throw new Error('checker must not read the response body')
    },
  }
}

function successfulFetch({ invalidKeyMode = 'decoy', onRequest } = {}) {
  return async (url, init) => {
    const headers = fixtureHeaders(init.headers)
    const origin = headers.get('origin')
    onRequest?.({ url, init, headers, origin })
    if (new URL(url).pathname === new URL(RUNTIME_WASM_URL).pathname) {
      if (init.method === 'HEAD') return fixtureResponse(200, runtimeHeaders())
      throw new Error(`unexpected runtime method: ${init.method}`)
    }
    if (init.method === 'OPTIONS') {
      return fixtureResponse(204, contractHeaders(origin))
    }
    if (init.method === 'HEAD') {
      return fixtureResponse(invalidKeyMode === 'decoy' ? 200 : 403, contractHeaders(origin))
    }
    throw new Error(`unexpected method: ${init.method}`)
  }
}

function silentWriter() {
  let output = ''
  return {
    stream: {
      write(value) {
        output += value
      },
    },
    read() {
      return output
    },
  }
}

test('decoy 模式验证两个 Origin，且只发送无授权的 OPTIONS/HEAD', async () => {
  const requests = []
  const result = await checkDeploymentContract({
    modelUrl: `${MODEL_URL}?existing=value`,
    invalidKeyMode: 'decoy',
    probeId: PROBE_ID,
    fetchImpl: successfulFetch({ onRequest: (request) => requests.push(request) }),
    attempts: 1,
    retryDelayMs: 0,
  })

  assert.equal(result.attempt, 1)
  assert.deepEqual(result.origins, ALLOWED_ORIGINS)
  assert.deepEqual(
    requests.map(({ init, origin }) => [init.method, origin]),
    ALLOWED_ORIGINS.flatMap((origin) => [
      ['OPTIONS', origin],
      ['HEAD', origin],
    ]),
  )
  for (const { url, init, headers } of requests) {
    const parsed = new URL(url)
    assert.equal(parsed.searchParams.get('existing'), 'value')
    assert.equal(parsed.searchParams.get('deployment_check'), PROBE_ID)
    assert.equal(init.redirect, 'error')
    assert.equal(headers.has('authorization'), false)
    assert.equal(headers.get('accept-encoding'), init.method === 'HEAD' ? 'identity' : null)
    assert.equal('body' in init, false)
  }
  const optionsHeaders = requests[0].headers
  assert.equal(optionsHeaders.get('access-control-request-method'), 'GET')
  assert.equal(optionsHeaders.get('access-control-request-headers'), 'Authorization')
})

test('error 模式接受无 Key HEAD 403', async () => {
  const result = await checkDeploymentContract({
    modelUrl: MODEL_URL,
    invalidKeyMode: 'error',
    probeId: PROBE_ID,
    fetchImpl: successfulFetch({ invalidKeyMode: 'error' }),
    attempts: 1,
  })

  assert.equal(result.invalidKeyMode, 'error')
})

test('扩展契约同时验证旧模型、ORT 模型和公开 WASM', async () => {
  const requests = []
  const result = await checkDeploymentContract({
    modelUrl: MODEL_URL,
    ortModelUrl: ORT_MODEL_URL,
    runtimeWasmUrl: RUNTIME_WASM_URL,
    runtimeWasmByteLength: RUNTIME_WASM_BYTE_LENGTH,
    invalidKeyMode: 'decoy',
    probeId: PROBE_ID,
    attempts: 1,
    fetchImpl: successfulFetch({ onRequest: (request) => requests.push(request) }),
  })

  assert.equal(result.assets, 3)
  assert.equal(requests.length, ALLOWED_ORIGINS.length * 4 + 1)
  assert.equal(requests.filter(({ url }) => new URL(url).pathname.endsWith('.ort')).length, ALLOWED_ORIGINS.length * 2)
  assert.equal(requests.at(-1).headers.has('authorization'), false)
})

test('扩展契约拒绝缺失的 ORT 路由', async () => {
  const success = successfulFetch()
  await assert.rejects(
    checkDeploymentContract({
      modelUrl: MODEL_URL,
      ortModelUrl: ORT_MODEL_URL,
      runtimeWasmUrl: RUNTIME_WASM_URL,
      runtimeWasmByteLength: RUNTIME_WASM_BYTE_LENGTH,
      invalidKeyMode: 'decoy',
      probeId: PROBE_ID,
      attempts: 1,
      fetchImpl: async (url, init) => {
        if (new URL(url).pathname === new URL(ORT_MODEL_URL).pathname && init.method === 'HEAD') {
          return fixtureResponse(404, contractHeaders(fixtureHeaders(init.headers).get('origin')))
        }
        return success(url, init)
      },
    }),
    /HEAD origin=.*asset=ort-model.*status mismatch; expected=200 actual=404/,
  )
})

test('拒绝线上旧 Worker 的 OPTIONS 405 fixture', async () => {
  await assert.rejects(
    checkDeploymentContract({
      modelUrl: MODEL_URL,
      invalidKeyMode: 'decoy',
      probeId: PROBE_ID,
      attempts: 1,
      fetchImpl: async () =>
        fixtureResponse(405, {
          allow: 'GET, HEAD',
          'access-control-allow-origin': '*',
          'cache-control': 'public, max-age=86400',
        }),
    }),
    (error) => {
      assert.match(error.message, /after 1 attempts/)
      assert.match(error.message, /OPTIONS origin=https:\/\/hentaiverse\.org/)
      assert.match(error.message, /status mismatch; expected=204 actual=405/)
      return true
    },
  )
})

test('拒绝缺失 Authorization 的 preflight 响应', async () => {
  await assert.rejects(
    checkDeploymentContract({
      modelUrl: MODEL_URL,
      invalidKeyMode: 'decoy',
      probeId: PROBE_ID,
      attempts: 1,
      fetchImpl: async (_url, init) => {
        const origin = fixtureHeaders(init.headers).get('origin')
        return fixtureResponse(204, contractHeaders(origin, { 'access-control-allow-headers': '' }))
      },
    }),
    /access-control-allow-headers mismatch; expected=\[authorization\] actual=\[<missing>\]/,
  )
})

test('OPTIONS token 集合忽略顺序与大小写', async () => {
  await checkDeploymentContract({
    modelUrl: MODEL_URL,
    invalidKeyMode: 'decoy',
    origins: [ALLOWED_ORIGINS[0]],
    probeId: PROBE_ID,
    attempts: 1,
    fetchImpl: async (_url, init) => {
      const origin = fixtureHeaders(init.headers).get('origin')
      if (init.method === 'OPTIONS') {
        return fixtureResponse(
          204,
          contractHeaders(origin, {
            'access-control-allow-methods': 'head,OPTIONS,get',
            'access-control-allow-headers': 'AUTHORIZATION',
          }),
        )
      }
      return fixtureResponse(200, contractHeaders(origin))
    },
  })
})

for (const mismatch of [
  {
    name: '错误 allow-origin',
    method: 'OPTIONS',
    headers: { 'access-control-allow-origin': '*' },
    expected: /access-control-allow-origin mismatch/,
  },
  {
    name: '额外 allow-method',
    method: 'OPTIONS',
    headers: { 'access-control-allow-methods': 'GET, HEAD, OPTIONS, POST' },
    expected: /access-control-allow-methods mismatch/,
  },
  {
    name: '错误 cache-control',
    method: 'HEAD',
    headers: { 'cache-control': 'public, max-age=86400' },
    expected: /HEAD origin=.*cache-control mismatch/,
  },
  {
    name: '缺失 Vary Origin',
    method: 'HEAD',
    headers: { vary: 'Accept-Encoding' },
    expected: /HEAD origin=.*Vary must include Origin/,
  },
]) {
  test(`拒绝${mismatch.name}`, async () => {
    await assert.rejects(
      checkDeploymentContract({
        modelUrl: MODEL_URL,
        invalidKeyMode: 'decoy',
        origins: [ALLOWED_ORIGINS[0]],
        probeId: PROBE_ID,
        attempts: 1,
        fetchImpl: async (_url, init) => {
          const origin = fixtureHeaders(init.headers).get('origin')
          const headers = contractHeaders(origin, init.method === mismatch.method ? mismatch.headers : {})
          return fixtureResponse(init.method === 'OPTIONS' ? 204 : 200, headers)
        },
      }),
      mismatch.expected,
    )
  })
}

test('默认重试配置覆盖 30 秒边缘传播窗口', () => {
  assert.equal(DEFAULT_ATTEMPTS, 5)
  assert.equal((DEFAULT_ATTEMPTS - 1) * DEFAULT_RETRY_DELAY_MS, 30_000)
})

test('网络失败后按固定间隔重试并成功', async () => {
  const requests = []
  const delays = []
  const success = successfulFetch({ onRequest: (request) => requests.push(request) })
  let firstRequest = true

  const result = await checkDeploymentContract({
    modelUrl: MODEL_URL,
    invalidKeyMode: 'decoy',
    probeId: PROBE_ID,
    attempts: 3,
    retryDelayMs: 25,
    fetchImpl: async (...args) => {
      if (firstRequest) {
        firstRequest = false
        throw new Error('temporary edge propagation failure')
      }
      return success(...args)
    },
    sleep: async (delay) => delays.push(delay),
  })

  assert.equal(result.attempt, 2)
  assert.deepEqual(delays, [25])
  assert.equal(requests.length, ALLOWED_ORIGINS.length * 2)
})

test('重试耗尽时保留次数、请求上下文和网络错误 cause', async () => {
  const networkError = new Error('connection reset')
  const delays = []

  await assert.rejects(
    checkDeploymentContract({
      modelUrl: MODEL_URL,
      invalidKeyMode: 'decoy',
      probeId: PROBE_ID,
      attempts: 2,
      retryDelayMs: 10,
      fetchImpl: async () => {
        throw networkError
      },
      sleep: async (delay) => delays.push(delay),
    }),
    (error) => {
      assert.match(error.message, /after 2 attempts/)
      assert.match(error.message, /OPTIONS origin=https:\/\/hentaiverse\.org/)
      assert.match(error.message, /connection reset/)
      assert.equal(error.cause.cause, networkError)
      return true
    },
  )
  assert.deepEqual(delays, [10])
})

test('无响应的请求按超时边界终止并耗尽有限重试', async () => {
  const signals = []
  const delays = []

  await assert.rejects(
    checkDeploymentContract({
      modelUrl: MODEL_URL,
      invalidKeyMode: 'decoy',
      probeId: PROBE_ID,
      attempts: 2,
      retryDelayMs: 0,
      requestTimeoutMs: 5,
      fetchImpl: async (_url, init) => {
        signals.push(init.signal)
        return await new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
        })
      },
      sleep: async (delay) => delays.push(delay),
    }),
    (error) => {
      assert.match(error.message, /after 2 attempts/)
      assert.match(error.message, /OPTIONS origin=https:\/\/hentaiverse\.org/)
      assert.match(error.message, /network request timed out after 5ms/)
      return true
    },
  )

  assert.equal(signals.length, 2)
  assert.ok(signals.every((signal) => signal.aborted))
  assert.deepEqual(delays, [0])
})

test('probe URL 保留原 query、替换旧 probe 并安全编码', () => {
  const url = new URL(createProbeUrl(`${MODEL_URL}?channel=stable&deployment_check=old`, PROBE_ID))

  assert.equal(url.searchParams.get('channel'), 'stable')
  assert.equal(url.searchParams.get('deployment_check'), PROBE_ID)
  assert.match(url.toString(), /deployment_check=run\+123%2Fattempt-2/)
})

test('在发起请求前拒绝非法配置', async () => {
  let fetchCalls = 0
  const fetchImpl = async () => {
    fetchCalls += 1
    throw new Error('must not run')
  }
  const base = {
    modelUrl: MODEL_URL,
    invalidKeyMode: 'decoy',
    probeId: PROBE_ID,
    fetchImpl,
  }

  await assert.rejects(checkDeploymentContract({ ...base, invalidKeyMode: 'allow' }), /invalidKeyMode/)
  await assert.rejects(checkDeploymentContract({ ...base, attempts: 0 }), /attempts/)
  await assert.rejects(checkDeploymentContract({ ...base, retryDelayMs: -1 }), /retryDelayMs/)
  await assert.rejects(checkDeploymentContract({ ...base, requestTimeoutMs: 0 }), /requestTimeoutMs/)
  await assert.rejects(checkDeploymentContract({ ...base, modelUrl: 'http://models.example/model.onnx' }), /HTTPS/)
  await assert.rejects(checkDeploymentContract({ ...base, origins: ['https://example.com/path'] }), /Invalid Origin/)
  await assert.rejects(checkDeploymentContract({ ...base, probeId: '' }), /probeId/)
  await assert.rejects(
    checkDeploymentContract({ ...base, ortModelUrl: ORT_MODEL_URL }),
    /must be provided together/,
  )
  assert.equal(fetchCalls, 0)
})

test('CLI 成功返回 0，且只输出简短的非秘密摘要', async () => {
  const stdout = silentWriter()
  const stderr = silentWriter()
  const exitCode = await runCli({
    env: {
      MODEL_WORKER_URL: MODEL_URL,
      MODEL_WORKER_ORT_URL: ORT_MODEL_URL,
      MODEL_WORKER_RUNTIME_WASM_URL: RUNTIME_WASM_URL,
      MODEL_WORKER_RUNTIME_WASM_BYTE_LENGTH: String(RUNTIME_WASM_BYTE_LENGTH),
      MODEL_WORKER_INVALID_KEY_MODE: 'decoy',
      MODEL_WORKER_PROBE_ID: 'workflow-1',
      MODEL_WORKER_CHECK_ATTEMPTS: '1',
      MODEL_WORKER_CHECK_RETRY_DELAY_MS: '0',
      MODEL_WORKER_CHECK_REQUEST_TIMEOUT_MS: '100',
    },
    fetchImpl: successfulFetch(),
    stdout: stdout.stream,
    stderr: stderr.stream,
  })

  assert.equal(exitCode, 0)
  assert.match(stdout.read(), /contract verified: attempt=1\/1 mode=decoy origins=2/)
  assert.equal(stderr.read(), '')
  assert.doesNotMatch(stdout.read(), /Authorization|Bearer/)
})

test('CLI 配置错误返回 1，且不会调用 fetch', async () => {
  const stdout = silentWriter()
  const stderr = silentWriter()
  let fetchCalls = 0
  const exitCode = await runCli({
    env: {
      MODEL_WORKER_URL: MODEL_URL,
      MODEL_WORKER_ORT_URL: ORT_MODEL_URL,
      MODEL_WORKER_RUNTIME_WASM_URL: RUNTIME_WASM_URL,
      MODEL_WORKER_RUNTIME_WASM_BYTE_LENGTH: String(RUNTIME_WASM_BYTE_LENGTH),
      MODEL_WORKER_INVALID_KEY_MODE: 'decoy',
      MODEL_WORKER_PROBE_ID: 'workflow-1',
      MODEL_WORKER_CHECK_ATTEMPTS: '1',
      MODEL_WORKER_CHECK_REQUEST_TIMEOUT_MS: '0',
    },
    fetchImpl: async () => {
      fetchCalls += 1
    },
    stdout: stdout.stream,
    stderr: stderr.stream,
  })

  assert.equal(exitCode, 1)
  assert.equal(stdout.read(), '')
  assert.match(stderr.read(), /MODEL_WORKER_CHECK_REQUEST_TIMEOUT_MS must be a positive safe integer/)
  assert.equal(fetchCalls, 0)
})
