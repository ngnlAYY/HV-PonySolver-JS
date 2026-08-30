import { describe, expect, it } from 'vitest'

import { isYoloParseResult } from '../../src/inference/inference-result-guard'

function result(overrides: Record<string, unknown> = {}): unknown {
  return {
    success: true,
    ponies: ['TS'],
    confidences: { TS: 0.9 },
    detections: [{ class_id: 0, confidence: 0.9 }],
    candidates: [{ class_id: 0, confidence: 0.9 }],
    ...overrides,
  }
}

describe('isYoloParseResult', () => {
  it('accepts a structurally and semantically consistent result', () => {
    expect(isYoloParseResult(result())).toBe(true)
  })

  it('rejects duplicate pony codes', () => {
    expect(isYoloParseResult(result({ ponies: ['TS', 'TS'] }))).toBe(false)
  })

  it('requires success to match the configured pony-count range', () => {
    expect(isYoloParseResult(result({ success: false }))).toBe(false)
    expect(isYoloParseResult(result({ success: true, ponies: [], confidences: {} }))).toBe(false)
    expect(
      isYoloParseResult(
        result({
          success: true,
          ponies: ['TS', 'RA', 'FS', 'RD'],
          confidences: { TS: 0.9, RA: 0.8, FS: 0.7, RD: 0.6 },
        }),
      ),
    ).toBe(false)
    expect(
      isYoloParseResult(
        result({
          success: false,
          ponies: ['TS', 'RA', 'FS', 'RD'],
          confidences: { TS: 0.9, RA: 0.8, FS: 0.7, RD: 0.6 },
        }),
      ),
    ).toBe(true)
  })

  it('requires confidence keys to match the unique pony list', () => {
    expect(isYoloParseResult(result({ confidences: {} }))).toBe(false)
    expect(isYoloParseResult(result({ confidences: { TS: 0.9, RA: 0.8 } }))).toBe(false)
  })
})
