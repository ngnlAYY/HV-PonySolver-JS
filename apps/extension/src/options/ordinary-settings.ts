import {
  ANSWER_MODE_STORAGE_KEY,
  DEFAULT_ANSWER_MODE,
  isAnswerMode,
} from '@hv-pony-solver/browser-core/captcha/answer-mode-settings'
import {
  parsePreserveCheckedAnswers,
  PRESERVE_CHECKED_ANSWERS_STORAGE_KEY,
} from '@hv-pony-solver/browser-core/captcha/answer-selection-settings'
import { parseRandomOnFail, RANDOM_ON_FAIL_STORAGE_KEY } from '@hv-pony-solver/browser-core/captcha/fallback-settings'
import { timingConfig } from '@hv-pony-solver/browser-core/captcha/timing-config'
import {
  MULTI_CLICK_DELAY_STORAGE_KEY,
  SUBMIT_DELAY_STORAGE_KEY,
  parseDelayRange,
  serializeDelayRange,
} from '@hv-pony-solver/browser-core/captcha/timing-settings'
import {
  DEFAULT_PANEL_HISTORY_LIMIT,
  DEFAULT_PANEL_POSITION,
  PANEL_COMPACT_MODE_STORAGE_KEY,
  PANEL_HISTORY_LIMIT_STORAGE_KEY,
  PANEL_POSITION_STORAGE_KEY,
  parsePanelHistoryLimit,
  parsePanelPosition,
  serializePanelPosition,
} from '@hv-pony-solver/browser-core/status-panel/panel-settings'
import { formatErrorMessage } from '@hv-pony-solver/browser-core/utils/errors'

import { storageGetAll, storageSet } from '../platform/webextension'

export type OptionsStatus = Readonly<{
  set(message: string, isError?: boolean): void
}>

export type OrdinarySettingsController = Readonly<{
  load(): Promise<void>
}>

export function optionsElement<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) {
    throw new Error(`设置页缺少元素: ${id}`)
  }
  return found as T
}

export function createOptionsStatus(): OptionsStatus {
  const output = optionsElement<HTMLOutputElement>('status')
  return {
    set(message, isError = false) {
      output.textContent = message
      output.dataset.kind = isError ? 'error' : 'success'
    },
  }
}

type OrdinaryField =
  | 'answerMode'
  | 'submitDelay'
  | 'multiClickDelay'
  | 'panelPosition'
  | 'panelCompact'
  | 'randomOnFail'
  | 'preserveCheckedAnswers'
  | 'historyLimit'

type FieldState = Readonly<{
  read(): string
  storageKey: string
  write(value: string): void
}>

type SaveField = Readonly<{
  storageValue: string
  uiValue: string
}>

type SaveIntent = Readonly<{
  fields: ReadonlyMap<OrdinaryField, SaveField>
  values: Record<string, string>
}>

const ordinaryFields: readonly OrdinaryField[] = [
  'answerMode',
  'submitDelay',
  'multiClickDelay',
  'panelPosition',
  'panelCompact',
  'randomOnFail',
  'preserveCheckedAnswers',
  'historyLimit',
]

function parseStoredValue(value: unknown, fallback: string, normalize: (value: string) => string): string {
  if (typeof value !== 'string') {
    return fallback
  }
  try {
    return normalize(value)
  } catch {
    return fallback
  }
}

export function installOrdinarySettingsController(status: OptionsStatus): OrdinarySettingsController {
  const form = optionsElement<HTMLFormElement>('settings-form')
  const answerMode = optionsElement<HTMLSelectElement>('answer-mode')
  const submitDelay = optionsElement<HTMLInputElement>('submit-delay')
  const multiClickDelay = optionsElement<HTMLInputElement>('multi-click-delay')
  const panelPosition = optionsElement<HTMLInputElement>('panel-position')
  const panelCompact = optionsElement<HTMLInputElement>('panel-compact')
  const randomOnFail = optionsElement<HTMLInputElement>('random-on-fail')
  const preserveCheckedAnswers = optionsElement<HTMLInputElement>('preserve-checked-answers')
  const historyLimit = optionsElement<HTMLInputElement>('history-limit')
  const saveButtonElement = form.querySelector<HTMLButtonElement>('button[type="submit"]')
  if (!saveButtonElement) {
    throw new Error('设置页缺少保存按钮')
  }
  const saveButton: HTMLButtonElement = saveButtonElement

  const fields: Record<OrdinaryField, FieldState> = {
    answerMode: {
      storageKey: ANSWER_MODE_STORAGE_KEY,
      read: () => answerMode.value,
      write: (value) => {
        answerMode.value = value
      },
    },
    submitDelay: {
      storageKey: SUBMIT_DELAY_STORAGE_KEY,
      read: () => submitDelay.value,
      write: (value) => {
        submitDelay.value = value
      },
    },
    multiClickDelay: {
      storageKey: MULTI_CLICK_DELAY_STORAGE_KEY,
      read: () => multiClickDelay.value,
      write: (value) => {
        multiClickDelay.value = value
      },
    },
    panelPosition: {
      storageKey: PANEL_POSITION_STORAGE_KEY,
      read: () => panelPosition.value,
      write: (value) => {
        panelPosition.value = value
      },
    },
    panelCompact: {
      storageKey: PANEL_COMPACT_MODE_STORAGE_KEY,
      read: () => (panelCompact.checked ? '1' : '0'),
      write: (value) => {
        panelCompact.checked = value === '1'
      },
    },
    randomOnFail: {
      storageKey: RANDOM_ON_FAIL_STORAGE_KEY,
      read: () => (randomOnFail.checked ? '1' : '0'),
      write: (value) => {
        randomOnFail.checked = value === '1'
      },
    },
    preserveCheckedAnswers: {
      storageKey: PRESERVE_CHECKED_ANSWERS_STORAGE_KEY,
      read: () => (preserveCheckedAnswers.checked ? '1' : '0'),
      write: (value) => {
        preserveCheckedAnswers.checked = value === '1'
      },
    },
    historyLimit: {
      storageKey: PANEL_HISTORY_LIMIT_STORAGE_KEY,
      read: () => historyLimit.value,
      write: (value) => {
        historyLimit.value = value
      },
    },
  }
  const initialValues = new Map<OrdinaryField, string>()
  const baselineValues = new Map<OrdinaryField, string>()
  const dirtyFields = new Set<OrdinaryField>()
  for (const field of ordinaryFields) {
    initialValues.set(field, fields[field].read())
  }

  let loaded = false
  let loading = false
  let pendingSaves = 0
  let saveGeneration = 0
  let saveTail: Promise<void> = Promise.resolve()
  saveButton.disabled = true

  function syncDirtyFields(): void {
    const referenceValues = loaded ? baselineValues : initialValues
    for (const field of ordinaryFields) {
      if (fields[field].read() === referenceValues.get(field)) {
        dirtyFields.delete(field)
      } else {
        dirtyFields.add(field)
      }
    }
  }

  function markDirty(field: OrdinaryField): void {
    const referenceValues = loaded ? baselineValues : initialValues
    if (fields[field].read() === referenceValues.get(field)) {
      dirtyFields.delete(field)
    } else {
      dirtyFields.add(field)
    }
  }

  for (const field of ordinaryFields) {
    const element =
      field === 'answerMode'
        ? answerMode
        : field === 'submitDelay'
          ? submitDelay
          : field === 'multiClickDelay'
            ? multiClickDelay
            : field === 'panelPosition'
              ? panelPosition
              : field === 'panelCompact'
                ? panelCompact
                : field === 'randomOnFail'
                  ? randomOnFail
                  : field === 'preserveCheckedAnswers'
                    ? preserveCheckedAnswers
                    : historyLimit
    const onChange = (): void => markDirty(field)
    element.addEventListener('input', onChange)
    element.addEventListener('change', onChange)
  }

  function loadedValues(values: Record<string, unknown>): Record<OrdinaryField, string> {
    const submitDelayDefault = serializeDelayRange(timingConfig.submitDelay)
    const multiClickDelayDefault = serializeDelayRange(timingConfig.multiClickDelay)
    const panelPositionDefault = serializePanelPosition(DEFAULT_PANEL_POSITION)
    return {
      answerMode: isAnswerMode(values[ANSWER_MODE_STORAGE_KEY]) ? values[ANSWER_MODE_STORAGE_KEY] : DEFAULT_ANSWER_MODE,
      submitDelay: parseStoredValue(values[SUBMIT_DELAY_STORAGE_KEY], submitDelayDefault, (value) =>
        serializeDelayRange(parseDelayRange(value)),
      ),
      multiClickDelay: parseStoredValue(values[MULTI_CLICK_DELAY_STORAGE_KEY], multiClickDelayDefault, (value) =>
        serializeDelayRange(parseDelayRange(value)),
      ),
      panelPosition: parseStoredValue(values[PANEL_POSITION_STORAGE_KEY], panelPositionDefault, (value) =>
        serializePanelPosition(parsePanelPosition(value)),
      ),
      panelCompact: values[PANEL_COMPACT_MODE_STORAGE_KEY] === '1' ? '1' : '0',
      randomOnFail: parseRandomOnFail(values[RANDOM_ON_FAIL_STORAGE_KEY]) ? '1' : '0',
      preserveCheckedAnswers: parsePreserveCheckedAnswers(values[PRESERVE_CHECKED_ANSWERS_STORAGE_KEY]) ? '1' : '0',
      historyLimit: parseStoredValue(
        values[PANEL_HISTORY_LIMIT_STORAGE_KEY],
        String(DEFAULT_PANEL_HISTORY_LIMIT),
        (value) => String(parsePanelHistoryLimit(value)),
      ),
    }
  }

  function serializeField(field: OrdinaryField, value: string): string {
    switch (field) {
      case 'answerMode':
        if (!isAnswerMode(value)) {
          throw new Error('答题模式无效')
        }
        return value
      case 'submitDelay':
      case 'multiClickDelay':
        return serializeDelayRange(parseDelayRange(value))
      case 'panelPosition':
        return serializePanelPosition(parsePanelPosition(value))
      case 'panelCompact':
      case 'randomOnFail':
      case 'preserveCheckedAnswers':
        return value === '1' ? '1' : '0'
      case 'historyLimit':
        return String(parsePanelHistoryLimit(value))
    }
  }

  function createSaveIntent(): SaveIntent {
    const intentFields = new Map<OrdinaryField, SaveField>()
    const values: Record<string, string> = {}
    for (const field of ordinaryFields) {
      if (!dirtyFields.has(field)) {
        continue
      }
      const uiValue = fields[field].read()
      const storageValue = serializeField(field, uiValue)
      intentFields.set(field, { storageValue, uiValue })
      values[fields[field].storageKey] = storageValue
    }
    return { fields: intentFields, values }
  }

  function commitSaveIntent(intent: SaveIntent): void {
    for (const [field, saveField] of intent.fields) {
      baselineValues.set(field, saveField.storageValue)
      if (fields[field].read() === saveField.uiValue) {
        fields[field].write(saveField.storageValue)
        dirtyFields.delete(field)
      } else {
        dirtyFields.add(field)
      }
    }
    syncDirtyFields()
  }

  function enqueueSave(intent: SaveIntent, generation: number): void {
    pendingSaves += 1
    saveButton.disabled = true
    status.set('正在保存设置…')
    const task = saveTail
      .catch(() => undefined)
      .then(async () => {
        try {
          if (generation !== saveGeneration) {
            return
          }
          await storageSet(intent.values)
          commitSaveIntent(intent)
          if (generation === saveGeneration) {
            status.set('设置已保存；已打开的游戏页面刷新后应用全部设置')
          }
        } catch (error) {
          if (generation === saveGeneration) {
            status.set(formatErrorMessage(error), true)
          }
        } finally {
          pendingSaves -= 1
          if (pendingSaves === 0) {
            saveButton.disabled = !loaded
          }
        }
      })
    saveTail = task
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!loaded || loading) {
      return
    }
    syncDirtyFields()
    const generation = ++saveGeneration
    let intent: SaveIntent
    try {
      intent = createSaveIntent()
    } catch (error) {
      status.set(formatErrorMessage(error), true)
      saveButton.disabled = pendingSaves > 0
      return
    }
    if (intent.fields.size === 0) {
      status.set('设置未修改')
      saveButton.disabled = pendingSaves > 0
      return
    }
    enqueueSave(intent, generation)
  })

  return {
    async load() {
      if (loaded || loading) {
        return
      }
      loading = true
      try {
        const values = await storageGetAll()
        // Catch programmatic edits as well as input/change events before applying storage.
        syncDirtyFields()
        const nextValues = loadedValues(values)
        for (const field of ordinaryFields) {
          const value = nextValues[field]
          baselineValues.set(field, value)
          if (!dirtyFields.has(field)) {
            fields[field].write(value)
          }
        }
        loaded = true
        syncDirtyFields()
      } catch (error) {
        syncDirtyFields()
        throw error
      } finally {
        loading = false
        if (pendingSaves === 0) {
          saveButton.disabled = !loaded
        }
      }
    },
  }
}
