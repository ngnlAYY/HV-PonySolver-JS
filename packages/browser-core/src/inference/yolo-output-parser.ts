import { answerCodeForClassId, type AnswerCode } from '@hv-pony-solver/shared/answer'
import { yoloOutputConfig } from './inference-config'
import type { Detection, YoloParseResult } from './inference-types'

const { rowSize, confidenceIndex, classIndex, maxDetections, confidenceThreshold } = yoloOutputConfig

function roundConfidence(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

/** 两个数组始终等长；原地右移保留同分顺序，避免 splice 的临时数组。 */
function insertTopDetection(classIds: number[], confidences: number[], classId: number, confidence: number): void {
  const length = classIds.length
  const lowestConfidence = confidences[length - 1]
  if (length === maxDetections && (lowestConfidence === undefined || confidence <= lowestConfidence)) {
    return
  }

  let index = Math.min(length, maxDetections - 1)
  while (index > 0) {
    const previousConfidence = confidences[index - 1]
    if (previousConfidence === undefined || confidence <= previousConfidence) break
    classIds[index] = classIds[index - 1] as number
    confidences[index] = previousConfidence
    index -= 1
  }
  classIds[index] = classId
  confidences[index] = confidence
}

function buildDetections(classIds: number[], confidences: number[]): Detection[] {
  const detections: Detection[] = []
  for (let i = 0; i < classIds.length; i += 1) {
    const classId = classIds[i]
    const confidence = confidences[i]
    if (classId === undefined || confidence === undefined) {
      continue
    }
    detections.push({
      class_id: classId,
      confidence: roundConfidence(confidence),
    })
  }
  return detections
}

type RankingAccumulator = {
  candidateClassIds: number[]
  candidateConfidences: number[]
}

function createRankingAccumulator(): RankingAccumulator {
  return {
    candidateClassIds: [],
    candidateConfidences: [],
  }
}

function finalizeRanking(state: RankingAccumulator): YoloParseResult {
  // 先以原始置信度确定前缀，再复用只读检测项，避免重复舍入和分配。
  const belowThreshold = state.candidateConfidences.findIndex((confidence) => confidence < confidenceThreshold)
  const detectionCount = belowThreshold === -1 ? state.candidateClassIds.length : Math.max(1, belowThreshold)
  const candidates = buildDetections(state.candidateClassIds, state.candidateConfidences)
  const detections = candidates.slice(0, detectionCount)

  const ponies: AnswerCode[] = []
  const confidences: Partial<Record<AnswerCode, number>> = {}

  for (const detection of detections) {
    const pony = answerCodeForClassId(detection.class_id)
    if (!pony) {
      continue
    }

    // 排名已降序排列，同一类别首次出现的置信度即为最高值。
    if (confidences[pony] === undefined) {
      ponies.push(pony)
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
    insertTopDetection(state.candidateClassIds, state.candidateConfidences, classId, confidence)
  }
  return finalizeRanking(state)
}
