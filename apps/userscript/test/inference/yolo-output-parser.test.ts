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
    expect(result.ponies).toEqual(['TS', 'FS'])
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
    expect(result.ponies).toEqual(['TS', 'RA', 'FS', 'RD'])
  })
})
