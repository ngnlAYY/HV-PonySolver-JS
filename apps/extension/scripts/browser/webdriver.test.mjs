import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { createWebDriverClient, findExecutable, startWebDriver } from './webdriver.mjs'

test('WebDriver client preserves results and errors and bounds stalled response bodies', async () => {
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.url === '/hang') {
      response.writeHead(200)
      response.flushHeaders()
      return
    }
    if (request.url === '/error') {
      response.statusCode = 500
      response.end(JSON.stringify({ value: { error: 'failure', message: 'driver detail' } }))
      return
    }
    response.end(JSON.stringify({ value: { sessionId: 'fixture' } }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = server.address().port
    const request = createWebDriverClient(port, { timeoutMs: 1_000 })
    assert.deepEqual(await request('POST', '/session', { capabilities: {} }), { sessionId: 'fixture' })
    await assert.rejects(request('GET', '/error'), /driver detail/u)
    await assert.rejects(createWebDriverClient(port, { timeoutMs: 30 })('GET', '/hang'), /abort|timeout/iu)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('WebDriver startup reports a missing executable without leaving a pending shutdown', async () => {
  await assert.rejects(startWebDriver('/nonexistent-hv-fixture/geckodriver'), /ENOENT|提前退出/u)
  assert.equal(await findExecutable(process.execPath), process.execPath)
})
