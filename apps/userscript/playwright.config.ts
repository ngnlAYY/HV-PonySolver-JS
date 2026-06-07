import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  outputDir: './.tmp/playwright-results',
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
