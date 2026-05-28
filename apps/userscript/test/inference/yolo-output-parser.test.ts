import { describe, expect, it } from 'vitest'

import { inferenceConfig } from '../../src/inference/inference-config'
import { parseYoloOutput } from '../../src/inference/yolo-output-parser'

describe('parseYoloOutput', () => {
  it('returns mapped ponies for rows above the confidence threshold', () => {
    const data = new Float32Array([
      0, 0, 0, 0, inferenceConfig.confidenceThreshold + 0.1, 0,
      0, 0, 0, 0, inferenceConfig.confidenceThreshold + 0.2, 2,
    ])

    const result = parseYoloOutput(data)

    expect(result.success).toBe(true)
    expect(result.ponies).toEqual(['FS', 'TS'])
    expect(result.confidences).toEqual({ TS: 0.4, FS: 0.5 })
  })

  it('falls back to the highest-confidence row when no row passes the threshold', () => {
    const data = new Float32Array([
      0, 0, 0, 0, 0.1, 1,
      0, 0, 0, 0, 0.2, 3,
    ])

    const result = parseYoloOutput(data)

    expect(result.success).toBe(true)
    expect(result.ponies).toEqual(['RD'])
    expect(result.confidences).toEqual({ RD: 0.2 })
  })

  it('keeps the highest confidence for duplicate pony classes', () => {
    const data = new Float32Array([
      0, 0, 0, 0, 0.31, 0,
      0, 0, 0, 0, 0.45, 0,
    ])

    const result = parseYoloOutput(data)

    expect(result.success).toBe(true)
    expect(result.ponies).toEqual(['TS'])
    expect(result.confidences).toEqual({ TS: 0.45 })
  })

  it('marks results with too many distinct pony kinds as unsuccessful', () => {
    const data = new Float32Array([
      0, 0, 0, 0, 0.91, 0,
      0, 0, 0, 0, 0.92, 1,
      0, 0, 0, 0, 0.93, 2,
      0, 0, 0, 0, 0.94, 3,
    ])

    const result = parseYoloOutput(data)

    expect(result.success).toBe(false)
    expect(result.ponies).toEqual(['RD', 'FS', 'RA', 'TS'])
  })

  it('keeps only the top detections sorted by confidence', () => {
    const rows: number[] = []
    for (let i = 0; i < inferenceConfig.maxDetections + 4; i += 1) {
      const confidence = i % 2 === 0 ? 0.31 + i / 100 : 0.95 - i / 100
      rows.push(0, 0, 0, 0, confidence, i % 6)
    }

    const result = parseYoloOutput(new Float32Array(rows))

    expect(result.detections).toHaveLength(inferenceConfig.maxDetections)
    expect(result.detections.map((detection) => detection.confidence)).toEqual(
      [...result.detections].map((detection) => detection.confidence).sort((left, right) => right - left),
    )
    expect(result.detections).not.toContainEqual(expect.objectContaining({ confidence: 0.31 }))
  })

  it('ignores non-finite confidences and invalid class ids', () => {
    const data = new Float32Array([
      0, 0, 0, 0, Number.NaN, 0,
      0, 0, 0, 0, Number.POSITIVE_INFINITY, 1,
      0, 0, 0, 0, 0.88, 999,
      0, 0, 0, 0, 0.77, 2,
    ])

    const result = parseYoloOutput(data)

    expect(result.success).toBe(true)
    expect(result.ponies).toEqual(['FS'])
    expect(result.confidences).toEqual({ FS: 0.77 })
  })

  it('falls back to the highest finite row with a valid class id', () => {
    const data = new Float32Array([
      0, 0, 0, 0, 0.29, 999,
      0, 0, 0, 0, Number.NaN, 0,
      0, 0, 0, 0, 0.21, 3,
      0, 0, 0, 0, 0.22, 2,
    ])

    const result = parseYoloOutput(data)

    expect(result.success).toBe(true)
    expect(result.ponies).toEqual(['FS'])
    expect(result.confidences).toEqual({ FS: 0.22 })
  })

  it('keeps below-threshold valid rows in candidates without adding them to threshold detections', () => {
    const data = new Float32Array([
      0, 0, 0, 0, inferenceConfig.confidenceThreshold - 0.05, 0,
      0, 0, 0, 0, inferenceConfig.confidenceThreshold + 0.1, 1,
      0, 0, 0, 0, inferenceConfig.confidenceThreshold - 0.01, 2,
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
      0, 0, 0, 0, Number.NaN, 0,
      0, 0, 0, 0, Number.POSITIVE_INFINITY, 1,
      0, 0, 0, 0, 0.99, 999,
    ]
    for (let i = 0; i < inferenceConfig.maxDetections + 3; i += 1) {
      rows.push(0, 0, 0, 0, 0.1 + i / 100, i % 6)
    }

    const result = parseYoloOutput(new Float32Array(rows))

    expect(result.candidates).toHaveLength(inferenceConfig.maxDetections)
    expect(result.candidates.map((detection) => detection.confidence)).toEqual(
      [...result.candidates].map((detection) => detection.confidence).sort((left, right) => right - left),
    )
    expect(result.candidates).not.toContainEqual(expect.objectContaining({ confidence: 0.1 }))
  })
})
