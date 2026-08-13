import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'lcov', 'json-summary'],
      thresholds: {
        statements: 72,
        branches: 64,
        functions: 68,
        lines: 72,
        'src/app/app.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
        'src/captcha/answer-submitter.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
        'src/captcha/captcha-solver.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
        'src/inference/onnx-worker-client.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
        'src/model/model-cache.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
        'src/model/model-downloader.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
})
