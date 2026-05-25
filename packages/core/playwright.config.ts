import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for caprr's integration suite.
 *
 * The CLAUDE.md testing layer describes this as the "lifecycle /
 * integration" layer: real MediaRecorder, real Blob assembly, real
 * sidecar embedding — only `navigator.mediaDevices.getDisplayMedia`
 * is stubbed (via the canvas-stream fixture in e2e/fixtures.ts) so
 * no permission picker is reached.
 *
 * Matrix: Chromium + Firefox + WebKit. Each lifecycle test asserts
 * the codec the browser actually negotiated. CI runs Chromium and
 * Firefox on Linux and WebKit on macOS (Playwright's bundled WebKit
 * on Linux ships no MediaRecorder) — see .github/workflows/ci.yml.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  // `html` writes an interactive report + the on-first-retry traces
  // into ./playwright-report; CI uploads that folder as an artifact
  // when a job fails so failures are debuggable without re-running.
  reporter: process.env['CI']
    ? [
        ['list'],
        ['github'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
      ]
    : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'pnpm --filter caprr-example-plain-html dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
    cwd: '../..',
  },
});
