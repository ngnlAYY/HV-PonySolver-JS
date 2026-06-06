import { describe, expect, it } from 'vitest'

import { inferenceConfig } from '../../src/inference/inference-config'
import { parseYoloOutput } from '../../src/inference/yolo-output-parser'

const yoloOutputConfig = inferenceConfig.yoloOutputConfig

function yoloRow(confidence: number, classId: number): number[] {
  const row = Array.from({ length: yoloOutputConfig.rowSize }, () => 0)
  row[yoloOutputConfig.confidenceIndex] = confidence
  row[yoloOutputConfig.classIndex] = classId
  return row
}

describe('parseYoloOutput', () => {
  it('documents the configured YOLO row layout', () => {
    expect(yoloOutputConfig).toEqual({
      rowSize: 6,
      confidenceIndex: 4,
      classIndex: 5,
    })
  })

  it('returns mapped ponies for rows above the confidence threshold', () => {
    const data = new Float32Array([
      ...yoloRow(inferenceConfig.confidenceThreshold + 0.1, 0),
      ...yoloRow(inferenceConfig.confidenceThreshold + 0.2, 2),
    ])

    const result = parseYoloOutput(data)

    expect(result.success).toBe(true)
    expect(result.ponies).toEqual(['FS', 'TS'])
    expect(result.confidences).toEqual({ TS: 0.4, FS: 0.5 })
  })

  it('falls back to the highest-confidence row when no row passes the threshold', () => {
    const data = new Float32Array([
      ...yoloRow(0.1, 1),
      ...yoloRow(0.2, 3),
    ])

    const result = parseYoloOutput(data)

    expect(result.success).toBe(true)
    expect(result.ponies).toEqual(['RD'])
    expect(result.confidences).toEqual({ RD: 0.2 })
    expect(result.detections).toEqual([{ class_id: 3, confidence: 0.2 }])
    expect(result.candidates).toEqual([
      { class_id: 3, confidence: 0.2 },
      { class_id: 1, confidence: 0.1 },
    ])
  })

  it('ignores a trailing partial row when data length is not a multiple of rowSize', () => {
    const partialRow = Array.from({ length: yoloOutputConfig.rowSize - 1 }, (_, index) => {
      return index === yoloOutputConfig.confidenceIndex ? 0.99 : 0
    })
    const data = new Float32Array([
      ...yoloRow(0.45, 0),
      ...partialRow,
    ])

    const result = parseYoloOutput(data)

    expect(result.success).toBe(true)
    expect(result.ponies).toEqual(['TS'])
    expect(result.confidences).toEqual({ TS: 0.45 })
    expect(result.detections).toEqual([{ class_id: 0, confidence: 0.45 }])
  })

  it('ignores NaN and Infinity confidences', () => {
    const data = new Float32Array([
      ...yoloRow(Number.NaN, 0),
      ...yoloRow(Number.POSITIVE_INFINITY, 1),
      ...yoloRow(0.77, 2),
    ])

    const result = parseYoloOutput(data)

    expect(result.success).toBe(true)
    expect(result.ponies).toEqual(['FS'])
    expect(result.confidences).toEqual({ FS: 0.77 })
    expect(result.candidates).toEqual([{ class_id: 2, confidence: 0.77 }])
  })

  it('keeps the highest confidence for duplicate pony classes', () => {
    const data = new Float32Array([
      ...yoloRow(0.31, 0),
      ...yoloRow(0.45, 0),
    ])

    const result = parseYoloOutput(data)

    expect(result.success).toBe(true)
    expect(result.ponies).toEqual(['TS'])
    expect(result.confidences).toEqual({ TS: 0.45 })
  })

  it('truncates floating class ids with Math.trunc before mapping answers', () => {
    const data = new Float32Array([
      ...yoloRow(0.6, 2.9),
      ...yoloRow(0.5, 3.9),
    ])

    const result = parseYoloOutput(data)

    expect(result.success).toBe(true)
    expect(result.ponies).toEqual(['FS', 'RD'])
    expect(result.confidences).toEqual({ FS: 0.6, RD: 0.5 })
    expect(result.detections).toEqual([
      { class_id: 2, confidence: 0.6 },
      { class_id: 3, confidence: 0.5 },
    ])
  })

  it('marks results with too many distinct pony kinds as unsuccessful while preserving all kinds', () => {
    const data = new Float32Array([
      ...yoloRow(0.91, 0),
      ...yoloRow(0.92, 1),
      ...yoloRow(0.93, 2),
      ...yoloRow(0.94, 3),
    ])

    const result = parseYoloOutput(data)

    expect(result.success).toBe(false)
    expect(result.ponies).toEqual(['RD', 'FS', 'RA', 'TS'])
    expect(result.confidences).toEqual({ RD: 0.94, FS: 0.93, RA: 0.92, TS: 0.91 })
  })

  it('keeps only the top detections sorted by confidence', () => {
    const rows: number[] = []
    for (let i = 0; i < inferenceConfig.maxDetections + 4; i += 1) {
      const confidence = i % 2 === 0 ? 0.31 + i / 100 : 0.95 - i / 100
      rows.push(...yoloRow(confidence, i % 6))
    }

    const result = parseYoloOutput(new Float32Array(rows))

    expect(result.detections).toHaveLength(inferenceConfig.maxDetections)
    expect(result.detections.map((detection) => detection.confidence)).toEqual(
      [...result.detections].map((detection) => detection.confidence).sort((left, right) => right - left),
    )
    expect(result.detections).not.toContainEqual(expect.objectContaining({ confidence: 0.31 }))
  })

  it('ignores invalid class ids', () => {
    const data = new Float32Array([
      ...yoloRow(0.88, 999),
      ...yoloRow(0.77, 2),
    ])

    const result = parseYoloOutput(data)

    expect(result.success).toBe(true)
    expect(result.ponies).toEqual(['FS'])
    expect(result.confidences).toEqual({ FS: 0.77 })
  })

  it('falls back to the highest finite row with a valid class id', () => {
    const data = new Float32Array([
      ...yoloRow(0.29, 999),
      ...yoloRow(Number.NaN, 0),
      ...yoloRow(0.21, 3),
      ...yoloRow(0.22, 2),
    ])

    const result = parseYoloOutput(data)

    expect(result.success).toBe(true)
    expect(result.ponies).toEqual(['FS'])
    expect(result.confidences).toEqual({ FS: 0.22 })
  })

  it('keeps below-threshold valid rows in candidates without adding them to threshold detections', () => {
    const data = new Float32Array([
      ...yoloRow(inferenceConfig.confidenceThreshold - 0.05, 0),
      ...yoloRow(inferenceConfig.confidenceThreshold + 0.1, 1),
      ...yoloRow(inferenceConfig.confidenceThreshold - 0.01, 2),
    ])

    const result = parseYoloOutput(data)

    expect(result.detections).toEqual([{ class_id: 1, confidence: 0.4 }])
    expect(result.candidates).toEqual([
      { class_id: 1, confidence: 0.4 },
      { class_id: 2, confidence: 0.29 },
      { class_id: 0, confidence: 0.25 },
    ])
  })

  it('limits candidates to maxDetections and ignores invalid rows', () => {
    const rows: number[] = [
      ...yoloRow(Number.NaN, 0),
      ...yoloRow(Number.POSITIVE_INFINITY, 1),
      ...yoloRow(0.99, 999),
    ]
    for (let i = 0; i < inferenceConfig.maxDetections + 3; i += 1) {
      rows.push(...yoloRow(0.1 + i / 100, i % 6))
    }

    const result = parseYoloOutput(new Float32Array(rows))

    expect(result.candidates).toHaveLength(inferenceConfig.maxDetections)
    expect(result.candidates.map((detection) => detection.confidence)).toEqual(
      [...result.candidates].map((detection) => detection.confidence).sort((left, right) => right - left),
    )
    expect(result.candidates).not.toContainEqual(expect.objectContaining({ confidence: 0.1 }))
  })
})
