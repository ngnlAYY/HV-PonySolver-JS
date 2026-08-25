/** Static fixture replacement used only by the packaged Chromium lifecycle smoke. */
export const fixtureBeforeDetect = (): Promise<unknown> =>
  new Promise((resolve) => setTimeout(resolve, 5_000, 'hv-pony-fixture-detect-delay'))
