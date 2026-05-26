export function createBlobWorker(workerScript: string): Worker {
  if (typeof Worker !== 'function' || typeof Blob !== 'function' || typeof URL !== 'function' || typeof URL.createObjectURL !== 'function') {
    throw new Error('当前环境不支持 Web Worker')
  }

  const workerBlob = new Blob([workerScript], { type: 'text/javascript' })
  const workerUrl = URL.createObjectURL(workerBlob)
  try {
    return new Worker(workerUrl)
  } finally {
    URL.revokeObjectURL(workerUrl)
  }
}
