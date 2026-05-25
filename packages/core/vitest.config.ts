import { defineConfig } from 'vitest/config';

// Pure-logic modules are tested under jsdom so DOM helpers (`document`,
// `getElementById`) work without booting a real browser. Lifecycle /
// integration coverage lives in `e2e/` under Playwright — see CLAUDE.md
// → Testing for the layering rationale.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'e2e/**'],
  },
});
