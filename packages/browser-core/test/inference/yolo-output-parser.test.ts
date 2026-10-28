import { describe, expect, it } from 'vitest'

import { yoloOutputConfig } from '../../src/inference/inference-config'
import type { YoloParseResult } from '../../src/inference/inference-types'
import { parseYoloOutputTensor } from '../../src/inference/yolo-output-parser'

function yoloRow(confidence: number, classId: number): number[] {
  const row = Array.from({ length: yoloOutputConfig.rowSize }, () => 0)
  row[yoloOutputConfig.confidenceIndex] = confidence
  row[yoloOutputConfig.classIndex] = classId
  return row
}

function parseRows(data: Float32Array): YoloParseResult {
  return parseYoloOutputTensor({ data, dims: [data.length / yoloOutputConfig.rowSize, yoloOutputConfig.rowSize] })
}

describe('YOLO ranking', () => {
  it('returns mapped ponies for rows above the confidence threshold', () => {
    const data = new Float32Array([
      ...yoloRow(yoloOutputConfig.confidenceThreshold + 0.1, 0),
      ...yoloRow(yoloOutputConfig.confidenceThreshold + 0.2, 2),
    ])

    const result = parseRows(data)

    expect(result.success).toBe(true)
    expect(result.ponies).toEqual(['FS', 'TS'])
    expect(result.confidences).toEqual({ TS: 0.4, FS: 0.5 })
  })

  it('falls back to the highest-confidence row when no row passes the threshold', () => {
    const data = new Float32Array([...yoloRow(0.1, 1), ...yoloRow(0.2, 3)])

    const result = parseRows(data)

    expect(result.success).toBe(true)
    expect(result.ponies).toEqual(['RD'])
    expect(result.confidences).toEqual({ RD: 0.2 })
    expect(result.detections).toEqual([{ class_id: 3, confidence: 0.2 }])
    expect(result.candidates).toEqual([
      { class_id: 3, confidence: 0.2 },
      { class_id: 1, confidence: 0.1 },
    ])
  })

  it('keeps the highest confidence for duplicate pony classes', () => {
    const data = new Float32Array([...yoloRow(0.31, 0), ...yoloRow(0.45, 0)])

    const result = parseRows(data)

    expect(result.success).toBe(true)
    expect(result.ponies).toEqual(['TS'])
    expect(result.confidences).toEqual({ TS: 0.45 })
  })

  it('marks results with too many distinct pony kinds as unsuccessful while preserving all kinds', () => {
    const data = new Float32Array([...yoloRow(0.91, 0), ...yoloRow(0.92, 1), ...yoloRow(0.93, 2), ...yoloRow(0.94, 3)])

    const result = parseRows(data)

    expect(result.success).toBe(false)
    expect(result.ponies).toEqual(['RD', 'FS', 'RA', 'TS'])
    expect(result.confidences).toEqual({ RD: 0.94, FS: 0.93, RA: 0.92, TS: 0.91 })
  })

  it('keeps below-threshold valid rows in candidates without adding them to threshold detections', () => {
    const data = new Float32Array([
      ...yoloRow(yoloOutputConfig.confidenceThreshold - 0.05, 0),
      ...yoloRow(yoloOutputConfig.confidenceThreshold + 0.1, 1),
      ...yoloRow(yoloOutputConfig.confidenceThreshold - 0.01, 2),
    ])

    const result = parseRows(data)

    expect(result.detections).toEqual([{ class_id: 1, confidence: 0.4 }])
    expect(result.candidates).toEqual([
      { class_id: 1, confidence: 0.4 },
      { class_id: 2, confidence: 0.29 },
      { class_id: 0, confidence: 0.25 },
    ])
  })
})

describe('parseYoloOutputTensor', () => {
  it('accepts the exact ONNX [1, rows, 6] tensor layout', () => {
    const data = new Float32Array([...yoloRow(0.8, 0), ...yoloRow(0.7, 2)])

    expect(parseYoloOutputTensor({ data, dims: [1, 2, yoloOutputConfig.rowSize] })).toMatchObject({
      success: true,
      ponies: ['TS', 'FS'],
    })
  })

  it('selects threshold detections before rounding public confidences', () => {
    const data = new Float32Array([...yoloRow(0.29999998, 0), ...yoloRow(0.30000001, 1), ...yoloRow(0.1, 2)])

    expect(parseYoloOutputTensor({ data, dims: [1, 3, 6] })).toEqual({
      success: true,
      ponies: ['RA'],
      confidences: { RA: 0.3 },
      detections: [{ class_id: 1, confidence: 0.3 }],
      candidates: [
        { class_id: 1, confidence: 0.3 },
        { class_id: 0, confidence: 0.3 },
        { class_id: 2, confidence: 0.1 },
      ],
    })
  })

  it('preserves input order for confidence ties at the top-candidate boundary', () => {
    const rows = Array.from({ length: yoloOutputConfig.maxDetections + 2 }, (_, index) => yoloRow(0.8, index % 6))
    const expected = rows.slice(0, yoloOutputConfig.maxDetections).map((row) => ({
      class_id: row[yoloOutputConfig.classIndex],
      confidence: 0.8,
    }))
    const result = parseYoloOutputTensor({ data: new Float32Array(rows.flat()), dims: [1, rows.length, 6] })

    expect(result.detections).toEqual(expected)
    expect(result.candidates).toEqual(expected)
    expect(result.ponies).toEqual(['TS', 'RA', 'FS', 'RD', 'PP', 'AJ'])
  })

  it('matches a stable full-sort oracle across ascending, descending, tied and mixed scores', () => {
    for (const count of [1, 15, 16, 17, 300]) {
      const patterns = [
        Array.from({ length: count }, (_, index) => (index + 1) / (count + 1)),
        Array.from({ length: count }, (_, index) => (count - index) / (count + 1)),
        Array.from({ length: count }, () => 0.8),
        Array.from({ length: count }, (_, index) => ((index * 73) % 101) / 100),
      ]
      for (const scores of patterns) {
        const rows = scores.map((score, index) => ({
          confidence: Math.fround(score),
          class_id: index % 6,
          index,
        }))
        const ranked = [...rows].sort((left, right) => right.confidence - left.confidence || left.index - right.index)
        const selected = ranked.filter((row) => row.confidence >= yoloOutputConfig.confidenceThreshold)
        const round = (row: (typeof rows)[number]) => ({
          class_id: row.class_id,
          confidence: Math.round(row.confidence * 1_000_000) / 1_000_000,
        })
        const result = parseRows(new Float32Array(rows.flatMap((row) => yoloRow(row.confidence, row.class_id))))

        expect(result.candidates).toEqual(ranked.slice(0, yoloOutputConfig.maxDetections).map(round))
        expect(result.detections).toEqual(
          (selected.length === 0 ? ranked.slice(0, 1) : selected.slice(0, yoloOutputConfig.maxDetections)).map(round),
        )
      }
    }
  })

  it('validates every column in rows that cannot enter the top-candidate list', () => {
    for (let column = 0; column < yoloOutputConfig.rowSize; column += 1) {
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const rows = Array.from({ length: yoloOutputConfig.maxDetections }, () => yoloRow(0.9, 0))
        const rejected = yoloRow(0.1, 1)
        rejected[column] = value
        rows.push(rejected)

        expect(() => parseRows(new Float32Array(rows.flat()))).toThrow(`模型输出第 ${rows.length} 行包含无效数值`)
      }
    }
  })

  it.each([
    { dims: [1, 1, 5], data: new Float32Array(6), message: '模型输出维度无效' },
    { dims: [1, 6], data: new Float32Array(5), message: '模型输出数据长度与维度不匹配' },
    { dims: [0, 6], data: new Float32Array(), message: '模型输出行数无效' },
    { dims: [1, 1, 1, 6], data: new Float32Array(6), message: '模型输出维度无效' },
  ])('rejects malformed tensor dimensions without accepting partial rows', ({ dims, data, message }) => {
    expect(() => parseYoloOutputTensor({ data, dims })).toThrow(message)
  })

  it('requires Float32 tensor data', () => {
    expect(() => parseYoloOutputTensor({ data: new Float64Array(6), dims: [1, 6] })).toThrow('模型输出格式无效')
  })

  it.each([
    { confidence: -0.01, classId: 0, message: '置信度无效' },
    { confidence: 1.01, classId: 0, message: '置信度无效' },
    { confidence: Number.NaN, classId: 0, message: '包含无效数值' },
    { confidence: 0.8, classId: 2.5, message: '类别无效' },
    { confidence: 0.8, classId: 999, message: '类别无效' },
  ])('rejects invalid confidence and exact class values', ({ confidence, classId, message }) => {
    const data = new Float32Array(yoloRow(confidence, classId))

    expect(() => parseYoloOutputTensor({ data, dims: [1, 6] })).toThrow(message)
  })
})
