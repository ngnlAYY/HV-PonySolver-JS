export const MODEL_CREDENTIALS_REVISION_KEY = 'hvPonySolverModelCredentialsRevision' as const

let lastIssuedRevision = 0

/**
 * Service-worker memory (and with it every live content Port) dies between a
 * failed Prepare and the later Key fix, so the durable storage change — not
 * only the Port broadcast — must be able to wake the one-shot recovery in
 * content scripts.
 */
export function nextModelCredentialsRevision(now: number = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('凭证版本时钟无效')
  }
  lastIssuedRevision = Math.max(now, lastIssuedRevision + 1)
  return lastIssuedRevision.toString(36)
}
