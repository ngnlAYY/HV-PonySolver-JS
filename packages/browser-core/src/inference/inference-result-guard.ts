import { ANSWER_CODES, type AnswerCode } from '@hv-pony-solver/shared/answer'
import { yoloOutputConfig } from './inference-config'
import type { Detection, YoloParseResult } from './inference-types'
import { isRecordObject } from '../utils/guards'

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && keys.every((key) => expected.includes(key))
}

function isAnswerCode(value: unknown): value is AnswerCode {
  return typeof value === 'string' && ANSWER_CODES.includes(value as AnswerCode)
}

function isDetection(value: unknown): value is Detection {
  return (
    isRecordObject(value) &&
    hasExactKeys(value, ['class_id', 'confidence']) &&
    Number.isInteger(value.class_id) &&
    Number(value.class_id) >= 0 &&
    Number(value.class_id) < ANSWER_CODES.length &&
    typeof value.confidence === 'number' &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1
  )
}

/** Strict validator for inference results crossing Worker or extension boundaries. */
export function isYoloParseResult(value: unknown): value is YoloParseResult {
  if (
    !isRecordObject(value) ||
    !hasExactKeys(value, ['success', 'ponies', 'confidences', 'detections', 'candidates']) ||
    typeof value.success !== 'boolean' ||
    !Array.isArray(value.ponies) ||
    value.ponies.length > ANSWER_CODES.length ||
    !value.ponies.every(isAnswerCode) ||
    !isRecordObject(value.confidences)
  ) {
    return false
  }
  const ponySet = new Set(value.ponies)
  const expectedSuccess = value.ponies.length >= 1 && value.ponies.length <= yoloOutputConfig.maxKinds
  if (ponySet.size !== value.ponies.length || value.success !== expectedSuccess) {
    return false
  }
  const confidenceKeys = Object.keys(value.confidences)
  if (confidenceKeys.length !== ponySet.size || !confidenceKeys.every((key) => isAnswerCode(key) && ponySet.has(key))) {
    return false
  }
  for (const [key, confidence] of Object.entries(value.confidences)) {
    if (
      !isAnswerCode(key) ||
      typeof confidence !== 'number' ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1
    ) {
      return false
    }
  }
  return (
    Array.isArray(value.detections) &&
    value.detections.length <= yoloOutputConfig.maxDetections &&
    value.detections.every(isDetection) &&
    Array.isArray(value.candidates) &&
    value.candidates.length <= yoloOutputConfig.maxDetections &&
    value.candidates.every(isDetection)
  )
}
