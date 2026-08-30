export type AssetIntegrity = Readonly<{
  byteLength: number
  sha256: string
}>

export type R2ObjectIntegrityMetadata = Readonly<{
  size: number
  checksums: Pick<R2Checksums, 'toJSON'>
}>

/**
 * Fail closed on canonical size drift. R2 exposes SHA-256 only when it was
 * recorded at upload time; when present, it must match the shared contract.
 */
export function hasExpectedR2ObjectIntegrity(object: R2ObjectIntegrityMetadata, expected: AssetIntegrity): boolean {
  if (object.size !== expected.byteLength) return false
  try {
    const sha256 = object.checksums.toJSON().sha256
    return sha256 === undefined || sha256.toLowerCase() === expected.sha256
  } catch {
    return false
  }
}
