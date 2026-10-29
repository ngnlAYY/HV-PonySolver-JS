export const MODEL_CREDENTIALS_REVISION_KEY = 'hvPonySolverModelCredentialsRevision' as const

/**
 * Persisted recovery survives lost Ports. Give every commit a fresh token:
 * timestamps and in-memory counters can repeat after a background restart.
 */
export function nextModelCredentialsRevision(): string {
  return crypto.randomUUID()
}
