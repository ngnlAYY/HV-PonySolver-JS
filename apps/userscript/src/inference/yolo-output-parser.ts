import { answerCodeForClassId, type AnswerCode } from '@hv-pony-solver/shared'
import { inferenceConfig } from './inference-config'
import type { Detection, YoloParseResult } from './inference-types'

function roundConfidence(value: number): number {
  return Math.round(Number(value) * 1_000_000) / 1_000_000
}

export function parseYoloOutput(data: Float32Array): YoloParseResult {
  const detections: Detection[] = []
  const totalRows = Math.floor(data.length / 6)

  for (let i = 0; i < totalRows; i += 1) {
    const base = i * 6
    const confidence = Number(data[base + 4])
    if (confidence >= inferenceConfig.confidenceThreshold) {
      detections.push({
        class_id: Math.trunc(Number(data[base + 5])),
        confidence: roundConfidence(confidence),
      })
      if (detections.length >= inferenceConfig.maxDetections) {
        break
      }
    }
  }

  if (!detections.length && totalRows > 0) {
    let bestBase = 0
    let bestConfidence = Number(data[4])
    for (let i = 1; i < totalRows; i += 1) {
      const base = i * 6
      const confidence = Number(data[base + 4])
      if (confidence > bestConfidence) {
        bestBase = base
        bestConfidence = confidence
      }
    }
    detections.push({
      class_id: Math.trunc(Number(data[bestBase + 5])),
      confidence: roundConfidence(bestConfidence),
    })
  }

  const seen = new Set<AnswerCode>()
  const ponies: AnswerCode[] = []
  const confidences: Partial<Record<AnswerCode, number>> = {}
  for (const detection of detections) {
    const pony = answerCodeForClassId(detection.class_id)
    if (!pony) {
      continue
    }
    if (!seen.has(pony)) {
      seen.add(pony)
      ponies.push(pony)
      confidences[pony] = detection.confidence
      continue
    }
    if (detection.confidence > (confidences[pony] ?? Number.NEGATIVE_INFINITY)) {
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
