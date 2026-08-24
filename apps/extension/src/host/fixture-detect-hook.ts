/**
 * Production builds keep this inert export; the build swaps the module for a
 * delaying hook only in the Chromium packaged fixture, whose lifecycle smoke
 * needs a deterministic in-flight detect window.
 */
export const fixtureBeforeDetect: (() => Promise<unknown>) | undefined = undefined
