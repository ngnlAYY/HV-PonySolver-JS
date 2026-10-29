import assert from 'node:assert/strict'

export async function saveSmokeSettings(page) {
  // 初始 HTML 的复选框未勾选；先等存储快照，否则 uncheck 可能空跑并被加载覆盖。
  await page.waitForFunction(
    () => globalThis.document.querySelector('#settings-form button[type="submit"]')?.disabled === false,
    undefined,
    { timeout: 15_000 },
  )
  await page.locator('#answer-mode').selectOption('auto')
  await page.locator('#submit-delay').fill('0')
  await page.locator('#multi-click-delay').fill('0')
  await page.locator('#random-on-fail').uncheck()
  assert.equal(await page.locator('#random-on-fail').isChecked(), false)
  await page.locator('button[type="submit"]').click()
  await page.locator('#status').filter({ hasText: '设置已保存' }).waitFor()

  const saved = await page.evaluate(
    () =>
      new Promise((resolve) => {
        globalThis.chrome.storage.local.get(
          ['hvPonySolverSubmitDelay', 'hvPonySolverMultiClickDelay', 'hvPonySolverRandomOnFail'],
          resolve,
        )
      }),
  )
  assert.equal(saved.hvPonySolverSubmitDelay, '0')
  assert.equal(saved.hvPonySolverMultiClickDelay, '0')
  assert.equal(saved.hvPonySolverRandomOnFail, '0')
  return { randomFallbackDisabled: saved.hvPonySolverRandomOnFail === '0' }
}
