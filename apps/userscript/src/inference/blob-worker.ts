export function createBlobWorker(workerScript: string): Worker {
  if (typeof Worker !== 'function' || typeof Blob !== 'function' || typeof URL !== 'function' || typeof URL.createObjectURL !== 'function') {
    throw new Error('当前环境不支持 Web Worker')
  }

  const workerBlob = new Blob([workerScript], { type: 'text/javascript' })
  const workerUrl = URL.createObjectURL(workerBlob)
  try {
    return new Worker(workerUrl)
  } catch (error) {
    if ((error as { name?: string } | null)?.name === 'SecurityError') {
      throw new Error('当前页面的内容安全策略（CSP）阻止了 blob: Worker；请让站点放宽 worker-src 后重试', { cause: error })
    }
    throw error
  } finally {
    URL.revokeObjectURL(workerUrl)
  }
}
