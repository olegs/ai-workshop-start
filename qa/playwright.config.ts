// The QA tests of spec/qa.md: `npm run qa`. The web view over the mock data, in Chromium, 1280×720, light; each page
// compared with its screenshot in qa/screenshots. CHROMIUM_PATH runs another Chromium than Playwright's own.
import { defineConfig } from '@playwright/test';

const port = Number(process.env.QA_PORT || 3100);

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // The expected screenshots, the test data: qa/screenshots/<name>.png, the same on every platform's name.
  snapshotPathTemplate: '{testDir}/screenshots/{arg}{ext}',
  outputDir: '../test-results/qa',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'line' : 'list',
  expect: {
    // A pixel differs past a colour threshold of 0.05; more than 0.1 % of them fails. 0.1 misses a change of background.
    toHaveScreenshot: { threshold: 0.05, maxDiffPixelRatio: 0.001, animations: 'disabled', caret: 'hide' },
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1280, height: 720 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-US',
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  // The mock server, no delay: the placeholders are not what the screenshots show.
  webServer: {
    command: 'node mock/server.ts',
    cwd: '..',
    env: { PORT: String(port), MOCK_DELAY: '0' },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
