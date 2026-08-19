import { vi } from 'vitest'

import type { StatusPanelContract as StatusPanel } from '@hv-pony-solver/browser-core'

export function createMockPanel(): StatusPanel {
  return {
    create: vi.fn(),
    destroy: vi.fn(),
    setStatus: vi.fn(),
    setSessionReady: vi.fn(),
    addSuccess: vi.fn(),
    addManualResult: vi.fn(),
    addRandomFailure: vi.fn(),
    addError: vi.fn(),
  }
}
