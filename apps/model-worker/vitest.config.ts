import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { renderWranglerConfigFile, testWranglerConfigEnv } from './scripts/wrangler-config-renderer.mjs'

const workerDir = dirname(fileURLToPath(import.meta.url))
const testWranglerConfigPath = resolve(workerDir, '.wrangler/vitest/wrangler.toml')

await renderWranglerConfigFile({
  templatePath: resolve(workerDir, 'wrangler.template.toml'),
  outputPath: testWranglerConfigPath,
  values: testWranglerConfigEnv,
  renderMode: 'test',
  outputName: 'apps/model-worker/.wrangler/vitest/wrangler.toml',
  mainPath: resolve(workerDir, 'src/index.ts'),
})

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: testWranglerConfigPath,
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 90,
        statements: 100,
      },
    },
  },
})
