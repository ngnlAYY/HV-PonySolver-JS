export type World = 'isekai' | 'main'
export type HistoryRecordType = 'success' | 'random' | 'error'

export type HistoryRecord = Readonly<{
  timestamp?: number
  time?: string
  type: HistoryRecordType
  answers: string
  elapsed: number
  message: string
}>
