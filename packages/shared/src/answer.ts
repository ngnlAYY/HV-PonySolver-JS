export const ANSWER_CODES = ['TS', 'RA', 'FS', 'RD', 'PP', 'AJ'] as const

export type AnswerCode = (typeof ANSWER_CODES)[number]

export function answerCodeForClassId(classId: number): AnswerCode | undefined {
  return ANSWER_CODES[classId]
}
