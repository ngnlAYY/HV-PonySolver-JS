import { vi } from 'vitest'

import type { StatusPanel } from '../../src/status-panel/status-panel-types'

export function createMockPanel(): StatusPanel {
  return {
    create: vi.fn(),
    destroy: vi.fn(),
    setStatus: vi.fn(),
    setSessionReady: vi.fn(),
    addSuccess: vi.fn(),
    addRandomFailure: vi.fn(),
    addError: vi.fn(),
  }
}
