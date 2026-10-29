import { describe, expect, it, vi } from 'vitest'

import { watchModelCredentialsRevision } from '../../src/content/credentials-watch'
import type { CommittedChangeListener, ExtensionStorageMirror } from '../../src/content/storage-mirror'
import { MODEL_CREDENTIALS_REVISION_KEY } from '../../src/protocol/model-credentials-revision'

function mirrorWithListeners(): {
  mirror: ExtensionStorageMirror
  emit: (key: string, newValue: string | null, oldValue: string | null) => void
} {
  const listeners = new Set<CommittedChangeListener>()
  const mirror = {
    addCommittedChangeListener: (listener: CommittedChangeListener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  } as unknown as ExtensionStorageMirror
  return {
    mirror,
    emit: (key, newValue, oldValue) => {
      for (const listener of [...listeners]) {
        listener(key, newValue, oldValue)
      }
    },
  }
}

describe('watchModelCredentialsRevision', () => {
  it('recovers after a background restart when the wall clock repeats a prior commit time', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_234_567)
    vi.resetModules()
    const firstBackground = await import('../../src/protocol/model-credentials-revision')
    const previous = firstBackground.nextModelCredentialsRevision()
    vi.resetModules()
    const replacementBackground = await import('../../src/protocol/model-credentials-revision')
    const current = replacementBackground.nextModelCredentialsRevision()
    const { mirror, emit } = mirrorWithListeners()
    const onCredentialsChanged = vi.fn()
    watchModelCredentialsRevision(mirror, onCredentialsChanged)

    emit(MODEL_CREDENTIALS_REVISION_KEY, current, previous)

    expect(onCredentialsChanged).toHaveBeenCalledOnce()
  })

  it('recovers only on real revision changes', () => {
    const { mirror, emit } = mirrorWithListeners()
    const onCredentialsChanged = vi.fn()
    watchModelCredentialsRevision(mirror, onCredentialsChanged)

    emit('hvPonySolverAnswerMode', 'manual', 'auto')
    emit(MODEL_CREDENTIALS_REVISION_KEY, null, 'old')
    emit(MODEL_CREDENTIALS_REVISION_KEY, 'same', 'same')
    expect(onCredentialsChanged).not.toHaveBeenCalled()

    emit(MODEL_CREDENTIALS_REVISION_KEY, 'fresh', 'old')
    expect(onCredentialsChanged).toHaveBeenCalledTimes(1)
  })
})
