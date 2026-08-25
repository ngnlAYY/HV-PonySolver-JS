/**
 * Wraps Fetch so browser-native implementations keep their Window/Worker
 * receiver even after crossing module or dependency-injection boundaries.
 */
export function resolveFetchImplementation(fetchImpl?: typeof fetch): typeof fetch {
  const implementation = fetchImpl ?? globalThis.fetch
  return (input, init) => implementation.call(globalThis, input, init)
}
