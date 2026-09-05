import type { EnumerableTextStorage, SettingsStorage } from '@hv-pony-solver/browser-core/platform/storage'
import { raceAbort } from '@hv-pony-solver/browser-core/utils/abort-race'
import {
  MAX_BUFFERED_STORAGE_KEYS,
  MAX_STORAGE_PREFIX_INDICES,
  STORAGE_INITIALIZATION_TIMEOUT_MS,
} from './storage-config'

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

export type CommittedChangeListener = (key: string, newValue: StoredValue, oldValue: StoredValue) => void

export class ExtensionStorageMirror implements SettingsStorage, EnumerableTextStorage {
  readonly synchronousSnapshot = true
  private readonly values = new Map<string, string>()
  private readonly prefixIndices = new Map<string, Map<string, string>>()
  private readonly mutationStates = new Map<string, MutationState>()
  private readonly committedChangeListeners = new Set<CommittedChangeListener>()
  private readonly bufferedChanges = new Map<string, StorageChanges[string]>()
  private removeChangeListener: (() => void) | null = null
  private initializing = true
  private destroyed = false
  private nextMutationId = 0

  private constructor(private readonly acceptsKey: (key: string) => boolean) {}

  static async create(
    options: Readonly<{ signal?: AbortSignal; acceptsKey?: (key: string) => boolean }> = {},
  ): Promise<ExtensionStorageMirror> {
    const mirror = new ExtensionStorageMirror(options.acceptsKey ?? (() => true))
    const controller = new AbortController()
    const onAbort = (): void => controller.abort(options.signal?.reason ?? new Error('扩展存储初始化已取消'))
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted) onAbort()
    const timeout = setTimeout(
      () => controller.abort(new Error('扩展存储初始化超时')),
      STORAGE_INITIALIZATION_TIMEOUT_MS,
    )
    try {
      mirror.removeChangeListener = addStorageChangeListener((changes, areaName) => {
        if (areaName !== 'local' || mirror.destroyed || controller.signal.aborted) {
          return
        }
        if (mirror.initializing) {
          for (const [key, change] of Object.entries(changes)) {
            if (!mirror.acceptsKey(key)) continue
            const previous = mirror.bufferedChanges.get(key)
            if (!previous && mirror.bufferedChanges.size >= MAX_BUFFERED_STORAGE_KEYS) {
              controller.abort(new Error('扩展存储初始化期间变更过多'))
              return
            }
            mirror.bufferedChanges.set(key, {
              oldValue: previous ? previous.oldValue : change.oldValue,
              newValue: change.newValue,
            })
          }
          return
        }
        mirror.applyChanges(changes)
      })

      const stored = await raceAbort(storageGetAll(), controller.signal)
      mirror.finishInitialization(stored)
      return mirror
    } catch (error) {
      mirror.destroy()
      throw error
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
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
    let index = this.prefixIndices.get(prefix)
    if (!index) {
      index = new Map<string, string>()
      for (const [key, value] of this.values) if (key.startsWith(prefix)) index.set(key, value)
      if (this.prefixIndices.size < MAX_STORAGE_PREFIX_INDICES) this.prefixIndices.set(prefix, index)
    }
    return Array.from(index)
  }

  /**
   * 转发 storage.onChanged 的已提交变更，不为本地乐观写入制造通知。
   * 浏览器也会为本上下文的已提交写入发送 onChanged。
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
    this.bufferedChanges.clear()
    this.prefixIndices.clear()
    this.committedChangeListeners.clear()
    this.mutationStates.clear()
    this.values.clear()
  }

  private finishInitialization(stored: Record<string, unknown>): void {
    if (this.destroyed) {
      return
    }
    for (const [key, value] of Object.entries(stored)) {
      if (this.acceptsKey(key) && typeof value === 'string') {
        this.setCommittedValue(key, value)
      }
    }
    this.initializing = false
    this.applyChanges(Object.fromEntries(this.bufferedChanges))
    this.bufferedChanges.clear()
  }

  private applyChanges(changes: StorageChanges): void {
    if (this.destroyed) {
      return
    }
    for (const [key, change] of Object.entries(changes)) {
      if (!this.acceptsKey(key)) continue
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
    if (this.destroyed || !this.acceptsKey(key)) {
      return Promise.reject(new Error(this.destroyed ? '扩展存储镜像已销毁' : '不支持的扩展存储项'))
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
    for (const [prefix, index] of this.prefixIndices) {
      if (!key.startsWith(prefix)) continue
      if (value === null) index.delete(key)
      else index.set(key, value)
    }
  }
}
