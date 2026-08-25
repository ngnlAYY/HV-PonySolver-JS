export type PendingModelDownloadConfirmation = Readonly<{
  accessKey: string
  fetchImpl: typeof fetch
  receiptId: string
}>

const pendingModelDownloadConfirmations = new WeakMap<ArrayBuffer, PendingModelDownloadConfirmation>()

export function registerModelDownloadConfirmation(
  buffer: ArrayBuffer,
  confirmation: PendingModelDownloadConfirmation,
): void {
  pendingModelDownloadConfirmations.set(buffer, confirmation)
}

export function copyModelDownloadConfirmation(source: ArrayBuffer, target: ArrayBuffer): void {
  const confirmation = pendingModelDownloadConfirmations.get(source)
  if (confirmation) {
    pendingModelDownloadConfirmations.set(target, confirmation)
  }
}

export function getModelDownloadConfirmation(buffer: ArrayBuffer): PendingModelDownloadConfirmation | undefined {
  return pendingModelDownloadConfirmations.get(buffer)
}

export function clearModelDownloadConfirmation(buffer: ArrayBuffer, expected: PendingModelDownloadConfirmation): void {
  if (pendingModelDownloadConfirmations.get(buffer) === expected) {
    pendingModelDownloadConfirmations.delete(buffer)
  }
}
