import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'lcov', 'json-summary'],
      thresholds: {
        statements: 81,
        branches: 78,
        functions: 76,
        lines: 82,
        'src/background/broker.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
        'src/content/remote-detector-client.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
        'src/content/storage-mirror.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
        'src/host/indexeddb-string-storage.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
        'src/host/inference-host.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
        'src/host/remote-inference-host.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
        'src/options/remote.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
})
