import { answerCodeForClassId, type AnswerCode } from '@hv-pony-solver/shared/answer'
import { yoloOutputConfig } from './inference-config'
import type { Detection, YoloParseResult } from './inference-types'

const { rowSize, confidenceIndex, classIndex, maxDetections, confidenceThreshold } = yoloOutputConfig

function roundConfidence(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function insertTopDetection(classIds: number[], confidences: number[], classId: number, confidence: number): void {
  if (classIds.length === maxDetections && confidence <= confidences[classIds.length - 1]!) {
    return
  }

  let index = 0
  while (index < classIds.length && confidence <= confidences[index]!) {
    index += 1
  }

  classIds.splice(index, 0, classId)
  confidences.splice(index, 0, confidence)

  if (classIds.length > maxDetections) {
    classIds.pop()
    confidences.pop()
  }
}

/** Parallel top-N arrays fed by insertTopDetection always stay equally long. */
function buildDetections(classIds: number[], confidences: number[]): Detection[] {
  const detections: Detection[] = []
  for (let i = 0; i < classIds.length; i += 1) {
    detections.push({
      class_id: classIds[i]!,
      confidence: roundConfidence(confidences[i]!),
    })
  }
  return detections
}

type RankingAccumulator = {
  detectionClassIds: number[]
  detectionConfidences: number[]
  candidateClassIds: number[]
  candidateConfidences: number[]
  bestClassId: number
  bestConfidence: number
}

function createRankingAccumulator(): RankingAccumulator {
  return {
    detectionClassIds: [],
    detectionConfidences: [],
    candidateClassIds: [],
    candidateConfidences: [],
    bestClassId: -1,
    bestConfidence: Number.NEGATIVE_INFINITY,
  }
}

function accumulateRow(state: RankingAccumulator, classId: number, confidence: number): void {
  insertTopDetection(state.candidateClassIds, state.candidateConfidences, classId, confidence)

  if (confidence > state.bestConfidence) {
    state.bestConfidence = confidence
    state.bestClassId = classId
  }

  if (confidence >= confidenceThreshold) {
    insertTopDetection(state.detectionClassIds, state.detectionConfidences, classId, confidence)
  }
}

function finalizeRanking(state: RankingAccumulator): YoloParseResult {
  if (state.detectionClassIds.length === 0 && state.bestConfidence !== Number.NEGATIVE_INFINITY) {
    state.detectionClassIds.push(state.bestClassId)
    state.detectionConfidences.push(state.bestConfidence)
  }

  const detections = buildDetections(state.detectionClassIds, state.detectionConfidences)
  const candidates = buildDetections(state.candidateClassIds, state.candidateConfidences)

  const ponies: AnswerCode[] = []
  const confidences: Partial<Record<AnswerCode, number>> = {}

  for (const detection of detections) {
    const pony = answerCodeForClassId(detection.class_id)
    if (!pony) {
      continue
    }

    const currentConfidence = confidences[pony]
    if (currentConfidence === undefined) {
      ponies.push(pony)
      confidences[pony] = detection.confidence
      continue
    }

    if (detection.confidence > currentConfidence) {
      confidences[pony] = detection.confidence
    }
  }

  return {
    success: ponies.length >= 1 && ponies.length <= yoloOutputConfig.maxKinds,
    ponies,
    confidences,
    detections,
    candidates,
  }
}

export type YoloOutputTensor = Readonly<{
  data: unknown
  dims: readonly number[]
}>

function validateTensorDimensions(dims: readonly number[], dataLength: number): number {
  let rows: number
  if (dims.length === 2) {
    const [rowCount, rowWidth] = dims
    if (rowCount === undefined || rowWidth !== rowSize) {
      throw new Error('模型输出维度无效')
    }
    rows = rowCount
  } else if (dims.length === 3) {
    const [batch, rowCount, rowWidth] = dims
    if (batch !== 1 || rowCount === undefined || rowWidth !== rowSize) {
      throw new Error('模型输出维度无效')
    }
    rows = rowCount
  } else {
    throw new Error('模型输出维度无效')
  }
  if (!Number.isSafeInteger(rows) || rows < 1 || rows > yoloOutputConfig.maxOutputRows) {
    throw new Error('模型输出行数无效')
  }
  if (rows * rowSize !== dataLength) {
    throw new Error('模型输出数据长度与维度不匹配')
  }
  return rows
}

/**
 * Strict Worker boundary validation fused with the ranking pass: one sweep per
 * row both rejects any non-finite value (including unused box columns, which is
 * a tamper-detection contract) and feeds the valid ones to the ranking.
 */
export function parseYoloOutputTensor(output: YoloOutputTensor): YoloParseResult {
  if (!(output.data instanceof Float32Array) || !Array.isArray(output.dims)) {
    throw new Error('模型输出格式无效')
  }
  const rows = validateTensorDimensions(output.dims, output.data.length)
  const state = createRankingAccumulator()
  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    const base = rowIndex * rowSize
    for (let column = 0; column < rowSize; column += 1) {
      if (!Number.isFinite(output.data[base + column])) {
        throw new Error(`模型输出第 ${rowIndex + 1} 行包含无效数值`)
      }
    }
    const confidence = output.data[base + confidenceIndex]
    const classId = output.data[base + classIndex]
    if (confidence === undefined || confidence < 0 || confidence > 1) {
      throw new Error(`模型输出第 ${rowIndex + 1} 行置信度无效`)
    }
    if (classId === undefined || !Number.isInteger(classId) || !answerCodeForClassId(classId)) {
      throw new Error(`模型输出第 ${rowIndex + 1} 行类别无效`)
    }
    accumulateRow(state, classId, confidence)
  }
  return finalizeRanking(state)
}

/**
 * Permissive ranking pass that skips invalid rows instead of rejecting them.
 *
 * @internal Must only run after parseYoloOutputTensor validated the tensor at
 * the Worker boundary; on its own it accepts malformed model output.
 */
export function parseYoloOutput(data: Float32Array): YoloParseResult {
  const state = createRankingAccumulator()
  const totalRows = Math.floor(data.length / rowSize)

  for (let rowIndex = 0; rowIndex < totalRows; rowIndex += 1) {
    const base = rowIndex * rowSize
    const confidence = Number(data[base + confidenceIndex])
    if (!Number.isFinite(confidence)) {
      continue
    }

    const classId = Math.trunc(Number(data[base + classIndex]))
    if (!answerCodeForClassId(classId)) {
      continue
    }

    accumulateRow(state, classId, confidence)
  }

  return finalizeRanking(state)
}
