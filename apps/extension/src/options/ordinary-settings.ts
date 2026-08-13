import {
  ANSWER_MODE_STORAGE_KEY,
  DEFAULT_ANSWER_MODE,
  isAnswerMode,
} from '@hv-pony-solver/browser-core/captcha/answer-mode-settings'
import { RANDOM_ON_FAIL_STORAGE_KEY } from '@hv-pony-solver/browser-core/captcha/fallback-settings'
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

import { storageGetAll, storageRemove, storageSet } from '../platform/webextension'

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

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function installOrdinarySettingsController(status: OptionsStatus): OrdinarySettingsController {
  const form = optionsElement<HTMLFormElement>('settings-form')
  const answerMode = optionsElement<HTMLSelectElement>('answer-mode')
  const submitDelay = optionsElement<HTMLInputElement>('submit-delay')
  const multiClickDelay = optionsElement<HTMLInputElement>('multi-click-delay')
  const panelPosition = optionsElement<HTMLInputElement>('panel-position')
  const panelCompact = optionsElement<HTMLInputElement>('panel-compact')
  const randomOnFail = optionsElement<HTMLInputElement>('random-on-fail')
  const historyLimit = optionsElement<HTMLInputElement>('history-limit')

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void (async () => {
      try {
        if (!isAnswerMode(answerMode.value)) {
          throw new Error('答题模式无效')
        }
        const values = {
          [ANSWER_MODE_STORAGE_KEY]: answerMode.value,
          [SUBMIT_DELAY_STORAGE_KEY]: serializeDelayRange(parseDelayRange(submitDelay.value)),
          [MULTI_CLICK_DELAY_STORAGE_KEY]: serializeDelayRange(parseDelayRange(multiClickDelay.value)),
          [PANEL_POSITION_STORAGE_KEY]: serializePanelPosition(parsePanelPosition(panelPosition.value)),
          [PANEL_HISTORY_LIMIT_STORAGE_KEY]: String(parsePanelHistoryLimit(historyLimit.value)),
          [RANDOM_ON_FAIL_STORAGE_KEY]: randomOnFail.checked ? '1' : '0',
        }
        await storageSet(values)
        if (panelCompact.checked) {
          await storageSet({ [PANEL_COMPACT_MODE_STORAGE_KEY]: '1' })
        } else {
          await storageRemove(PANEL_COMPACT_MODE_STORAGE_KEY)
        }
        status.set('设置已保存；已打开的游戏页面刷新后应用全部设置')
      } catch (error) {
        status.set(errorMessage(error), true)
      }
    })()
  })

  return {
    async load() {
      const values = await storageGetAll()
      answerMode.value = isAnswerMode(values[ANSWER_MODE_STORAGE_KEY])
        ? values[ANSWER_MODE_STORAGE_KEY]
        : DEFAULT_ANSWER_MODE
      submitDelay.value = typeof values[SUBMIT_DELAY_STORAGE_KEY] === 'string'
        ? values[SUBMIT_DELAY_STORAGE_KEY]
        : serializeDelayRange(timingConfig.submitDelay)
      multiClickDelay.value = typeof values[MULTI_CLICK_DELAY_STORAGE_KEY] === 'string'
        ? values[MULTI_CLICK_DELAY_STORAGE_KEY]
        : serializeDelayRange(timingConfig.multiClickDelay)
      panelPosition.value = typeof values[PANEL_POSITION_STORAGE_KEY] === 'string'
        ? values[PANEL_POSITION_STORAGE_KEY]
        : serializePanelPosition(DEFAULT_PANEL_POSITION)
      panelCompact.checked = values[PANEL_COMPACT_MODE_STORAGE_KEY] === '1'
      randomOnFail.checked = values[RANDOM_ON_FAIL_STORAGE_KEY] === undefined || values[RANDOM_ON_FAIL_STORAGE_KEY] === '1'
      historyLimit.value = typeof values[PANEL_HISTORY_LIMIT_STORAGE_KEY] === 'string'
        ? values[PANEL_HISTORY_LIMIT_STORAGE_KEY]
        : String(DEFAULT_PANEL_HISTORY_LIMIT)
    },
  }
}
