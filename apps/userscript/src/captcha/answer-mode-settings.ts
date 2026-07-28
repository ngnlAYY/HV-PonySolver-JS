import { alertUser, getGmValue, promptUser, setGmValue } from '../userscript/gm-bridge'

export type AnswerMode = 'auto' | 'manual'

export const ANSWER_MODE_STORAGE_KEY = 'hvPonySolverAnswerMode'

const DEFAULT_ANSWER_MODE: AnswerMode = 'auto'
const ANSWER_MODE_PROMPT = ['请选择答题模式：', '1. 自动选择并提交', '2. 仅识别，手动选择并提交'].join('\n')

function isAnswerMode(value: string): value is AnswerMode {
  return value === 'auto' || value === 'manual'
}

export async function getAnswerMode(): Promise<AnswerMode> {
  try {
    const saved = await getGmValue(ANSWER_MODE_STORAGE_KEY)
    return isAnswerMode(saved) ? saved : DEFAULT_ANSWER_MODE
  } catch {
    return DEFAULT_ANSWER_MODE
  }
}

export async function setAnswerMode(mode: AnswerMode): Promise<void> {
  await setGmValue(ANSWER_MODE_STORAGE_KEY, mode)
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
