import {
  ANSWER_MODE_STORAGE_KEY,
  getAnswerMode as getCoreAnswerMode,
  setAnswerMode as setCoreAnswerMode,
  type AnswerMode,
} from '@hv-pony-solver/browser-core'

import { alertUser, promptUser } from '../userscript/gm-bridge'
import { gmSettingsStorage } from '../userscript/gm-storage'

export type { AnswerMode }
export { ANSWER_MODE_STORAGE_KEY }

const ANSWER_MODE_PROMPT = ['请选择答题模式：', '1. 自动选择并提交', '2. 仅识别，手动选择并提交'].join('\n')

export function getAnswerMode(): Promise<AnswerMode> {
  return getCoreAnswerMode(gmSettingsStorage)
}

export function setAnswerMode(mode: AnswerMode): Promise<void> {
  return setCoreAnswerMode(gmSettingsStorage, mode)
}

export async function setAnswerModeFromPrompt(): Promise<void> {
  const currentMode = await getAnswerMode()
  const input = promptUser(ANSWER_MODE_PROMPT, currentMode === 'auto' ? '1' : '2')
  if (input === null) {
    return
  }

  const selected = input.trim()
  if (selected !== '1' && selected !== '2') {
    throw new Error('答题模式选项无效')
  }

  await setAnswerMode(selected === '1' ? 'auto' : 'manual')
  alertUser('答题模式已保存，从下一次验证码处理开始生效')
}
