import { defineConfig, devices } from '@playwright/test';

const STORAGE_STATE = '.auth/developer.json';
const BASE_URL = 'http://localhost:8081';

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.spec\.js/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'unauthed',
      testMatch: /login\.spec\.js/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'authed',
      testMatch: /(smoke|issue-detail)\.spec\.js/,
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'npm run start:e2e',
    url: `${BASE_URL}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
