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

  it('sorts detections by confidence before applying maxDetections', () => {
    const rows: number[] = []
    for (let i = 0; i < inferenceConfig.maxDetections; i += 1) {
      rows.push(0, 0, 0, 0, 0.31, 1)
    }
    rows.push(0, 0, 0, 0, 0.99, 0)

    const result = parseYoloOutput(new Float32Array(rows))

    expect(result.ponies[0]).toBe('TS')
    expect(result.confidences.TS).toBe(0.99)
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
})
