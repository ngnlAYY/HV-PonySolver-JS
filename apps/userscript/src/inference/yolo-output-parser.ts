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

function insertTopDetection(detections: Detection[], detection: Detection): void {
  if (detections.length === inferenceConfig.maxDetections && detection.confidence <= detections[detections.length - 1]!.confidence) {
    return
  }
  const index = detections.findIndex((candidate) => detection.confidence > candidate.confidence)
  if (index === -1) {
    detections.push(detection)
  } else {
    detections.splice(index, 0, detection)
  }
  if (detections.length > inferenceConfig.maxDetections) {
    detections.pop()
  }
}

export function parseYoloOutput(data: Float32Array): YoloParseResult {
  const detections: Detection[] = []
  const candidates: Detection[] = []
  let bestDetection: Detection | null = null
  const totalRows = Math.floor(data.length / 6)

  for (let i = 0; i < totalRows; i += 1) {
    const detection = readDetection(data, i)
    if (!detection) {
      continue
    }
    insertTopDetection(candidates, detection)
    if (!bestDetection || detection.confidence > bestDetection.confidence) {
      bestDetection = detection
    }
    if (detection.confidence >= inferenceConfig.confidenceThreshold) {
      insertTopDetection(detections, detection)
    }
  }

  if (!detections.length && bestDetection) {
    detections.push(bestDetection)
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
    candidates,
  }
}
