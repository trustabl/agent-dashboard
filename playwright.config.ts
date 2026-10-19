import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'

// E2E: builds and starts the real Console on a private port with a throwaway
// home (tests/.tmp/home), against fixture repos copied to tests/.tmp/repos.
// The pinned CLIs are real; set TRUSTABL_TOOLS_ARCHIVE_DIR to install them
// from local archives when GitHub is unreachable.
const PORT = Number(process.env.E2E_PORT ?? 4318)
export const E2E_HOME = path.resolve(__dirname, 'tests/.tmp/home')

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } } : {}),
  },
  webServer: {
    command: `node tests/e2e/setup.mjs && npx next build && npx next start -H 127.0.0.1 -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/status`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      TRUSTABL_CONSOLE_HOME: E2E_HOME,
      NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
