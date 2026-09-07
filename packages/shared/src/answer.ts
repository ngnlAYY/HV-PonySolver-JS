/** Stable answer codes shared by the detector, DOM submitter, and protocols. */
export const ANSWER_CODES = ['TS', 'RA', 'FS', 'RD', 'PP', 'AJ'] as const

export type AnswerCode = (typeof ANSWER_CODES)[number]

/** Maps the model's zero-based class id to the corresponding answer code. */
export function answerCodeForClassId(classId: number): AnswerCode | undefined {
  return ANSWER_CODES[classId]
}
