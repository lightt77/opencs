import { defineConfig } from '@playwright/test';

const port = process.env.OPENCS_PORT ?? '5173';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  use: {
    channel: 'chromium',
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--enable-webgl', '--use-angle=metal', '--disable-background-timer-throttling'] },
  },
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
