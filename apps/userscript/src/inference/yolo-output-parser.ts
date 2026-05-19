import { answerCodeForClassId, type AnswerCode } from '@hv-pony-solver/shared'
import { inferenceConfig } from './inference-config'
import type { Detection, YoloParseResult } from './inference-types'

function roundConfidence(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function readDetection(data: Float32Array, rowIndex: number): Detection | null {
  const base = rowIndex * 6
  const confidence = Number(data[base + 4])
  const classId = Math.trunc(Number(data[base + 5]))
  if (!Number.isFinite(confidence) || !answerCodeForClassId(classId)) {
    return null
  }
  return {
    class_id: classId,
    confidence: roundConfidence(confidence),
  }
}

export function parseYoloOutput(data: Float32Array): YoloParseResult {
  const allDetections: Detection[] = []
  const totalRows = Math.floor(data.length / 6)

  for (let i = 0; i < totalRows; i += 1) {
    const detection = readDetection(data, i)
    if (detection) {
      allDetections.push(detection)
    }
  }

  const detections = allDetections
    .filter((detection) => detection.confidence >= inferenceConfig.confidenceThreshold)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, inferenceConfig.maxDetections)

  if (!detections.length && allDetections.length) {
    const best = [...allDetections].sort((left, right) => right.confidence - left.confidence)[0]
    if (best) {
      detections.push(best)
    }
  }

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
    success: ponies.length >= 1 && ponies.length <= inferenceConfig.maxKinds,
    ponies,
    confidences,
    detections,
  }
}
