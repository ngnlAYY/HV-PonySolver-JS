export type World = 'isekai' | 'main'

export type HistoryRecordBase = Readonly<{
  timestamp?: number
  time?: string
  elapsed: number
}>

export type SuccessHistoryRecord = HistoryRecordBase &
  Readonly<{
    type: 'success'
    answers: string
  }>

export type ManualHistoryRecord = HistoryRecordBase &
  Readonly<{
    type: 'manual'
    answers: string
  }>

export type RandomHistoryRecord = HistoryRecordBase &
  Readonly<{
    type: 'random'
    answers: string
    message: string
  }>

export type ErrorHistoryRecord = HistoryRecordBase &
  Readonly<{
    type: 'error'
    message: string
  }>

export type HistoryRecord = SuccessHistoryRecord | ManualHistoryRecord | RandomHistoryRecord | ErrorHistoryRecord
export type HistoryRecordType = HistoryRecord['type']
