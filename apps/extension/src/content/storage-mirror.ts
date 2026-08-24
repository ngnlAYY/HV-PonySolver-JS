import type { EnumerableTextStorage, SettingsStorage } from '@hv-pony-solver/browser-core/platform/storage'

import {
  addStorageChangeListener,
  storageGetAll,
  storageRemove,
  storageSet,
  type StorageChanges,
} from '../platform/webextension'

type StoredValue = string | null

type PendingMutation = {
  readonly id: number
  readonly value: StoredValue
  writeRevision: number
}

type MutationState = {
  committedValue: StoredValue
  committedRevision: number
  readonly pending: PendingMutation[]
  tail: Promise<void>
}

export type CommittedChangeListener = (
  key: string,
  newValue: StoredValue,
  oldValue: StoredValue,
) => void

export class ExtensionStorageMirror implements SettingsStorage, EnumerableTextStorage {
  private readonly values = new Map<string, string>()
  private readonly mutationStates = new Map<string, MutationState>()
  private readonly committedChangeListeners = new Set<CommittedChangeListener>()
  private readonly bufferedChanges: StorageChanges[] = []
  private removeChangeListener: (() => void) | null = null
  private initializing = true
  private destroyed = false
  private nextMutationId = 0

  static async create(): Promise<ExtensionStorageMirror> {
    const mirror = new ExtensionStorageMirror()
    mirror.removeChangeListener = addStorageChangeListener((changes, areaName) => {
      if (areaName !== 'local' || mirror.destroyed) {
        return
      }
      if (mirror.initializing) {
        mirror.bufferedChanges.push(changes)
        return
      }
      mirror.applyChanges(changes)
    })

    try {
      const stored = await storageGetAll()
      mirror.finishInitialization(stored)
      return mirror
    } catch (error) {
      mirror.destroy()
      throw error
    }
  }

  getSync(key: string): string | null {
    return this.values.get(key) ?? null
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.getSync(key))
  }

  set(key: string, value: string): Promise<void> {
    return this.mutate(key, value, () => storageSet({ [key]: value }))
  }

  remove(key: string): Promise<void> {
    return this.mutate(key, null, () => storageRemove(key))
  }

  getItem(key: string): string | null {
    return this.getSync(key)
  }

  setItem(key: string, value: string): Promise<void> {
    return this.set(key, value)
  }

  removeItem(key: string): Promise<void> {
    return this.remove(key)
  }

  getItemsByPrefix(prefix: string): ReadonlyArray<readonly [key: string, value: string]> {
    return Array.from(this.values.entries()).filter(([key]) => key.startsWith(prefix))
  }

  /**
   * Observes externally committed storage changes (never this mirror's own
   * writes), including the buffered replay of changes that arrived while the
   * initial snapshot was still loading.
   */
  addCommittedChangeListener(listener: CommittedChangeListener): () => void {
    this.committedChangeListeners.add(listener)
    return () => {
      this.committedChangeListeners.delete(listener)
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    this.initializing = false
    this.removeChangeListener?.()
    this.removeChangeListener = null
    this.bufferedChanges.length = 0
    this.committedChangeListeners.clear()
    this.mutationStates.clear()
    this.values.clear()
  }

  private finishInitialization(stored: Record<string, unknown>): void {
    if (this.destroyed) {
      return
    }
    for (const [key, value] of Object.entries(stored)) {
      if (typeof value === 'string') {
        this.setCommittedValue(key, value)
      }
    }
    this.initializing = false
    for (const changes of this.bufferedChanges.splice(0)) {
      this.applyChanges(changes)
    }
  }

  private applyChanges(changes: StorageChanges): void {
    if (this.destroyed) {
      return
    }
    for (const [key, change] of Object.entries(changes)) {
      const oldValue = typeof change.oldValue === 'string' ? change.oldValue : null
      const newValue = typeof change.newValue === 'string' ? change.newValue : null
      this.setCommittedValue(key, newValue)
      for (const listener of [...this.committedChangeListeners]) {
        listener(key, newValue, oldValue)
      }
    }
  }

  private setCommittedValue(key: string, value: StoredValue): void {
    const state = this.mutationStates.get(key)
    if (!state) {
      this.setVisibleValue(key, value)
      return
    }
    state.committedValue = value
    state.committedRevision += 1
    this.refreshVisibleValue(key, state)
  }

  private mutate(key: string, value: StoredValue, persist: () => Promise<void>): Promise<void> {
    if (this.destroyed) {
      return Promise.reject(new Error('扩展存储镜像已销毁'))
    }

    const state = this.getMutationState(key)
    const mutation: PendingMutation = {
      id: ++this.nextMutationId,
      value,
      writeRevision: state.committedRevision,
    }
    state.pending.push(mutation)
    this.refreshVisibleValue(key, state)

    const operation = state.tail.then(() => {
      mutation.writeRevision = state.committedRevision
      return persist()
    })
    const settled = operation.then(
      () => this.settleMutation(key, state, mutation, true),
      (error: unknown) => {
        this.settleMutation(key, state, mutation, false)
        throw error
      },
    )
    state.tail = settled.catch(() => undefined)
    return settled
  }

  private settleMutation(key: string, state: MutationState, mutation: PendingMutation, succeeded: boolean): void {
    if (this.destroyed || this.mutationStates.get(key) !== state) {
      return
    }
    const index = state.pending.findIndex(({ id }) => id === mutation.id)
    if (index >= 0) {
      state.pending.splice(index, 1)
    }
    if (succeeded && state.committedRevision === mutation.writeRevision) {
      state.committedValue = mutation.value
      state.committedRevision += 1
    }
    this.refreshVisibleValue(key, state)
    if (state.pending.length === 0) {
      this.mutationStates.delete(key)
    }
  }

  private getMutationState(key: string): MutationState {
    const existing = this.mutationStates.get(key)
    if (existing) {
      return existing
    }
    const state: MutationState = {
      committedValue: this.values.get(key) ?? null,
      committedRevision: 0,
      pending: [],
      tail: Promise.resolve(),
    }
    this.mutationStates.set(key, state)
    return state
  }

  private refreshVisibleValue(key: string, state: MutationState): void {
    const latestMutation = state.pending.at(-1)
    this.setVisibleValue(key, latestMutation ? latestMutation.value : state.committedValue)
  }

  private setVisibleValue(key: string, value: StoredValue): void {
    if (value === null) {
      this.values.delete(key)
    } else {
      this.values.set(key, value)
    }
  }
}
