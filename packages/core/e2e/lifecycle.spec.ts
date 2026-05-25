import { expect, test } from './fixtures';
import { installCanvasGetDisplayMediaStub } from './fixtures';

test.describe('recorder lifecycle (canvas-stream stub)', () => {
  test('transitions from Idle → REC … on toggle click', async ({ page }) => {
    await installCanvasGetDisplayMediaStub(page);
    await page.goto('/');

    // Pill renders in the corner; #caprr-status starts at "Idle".
    await expect(page.locator('#caprr-status')).toHaveText('Idle');

    // Click the toggle to start. The canvas-stream stub means
    // getDisplayMedia resolves with a MediaStream, MediaRecorder starts,
    // and rrweb begins emitting events. State transitions:
    //   idle → starting → recording. The starting state is brief in tests
    //   because the stub resolves synchronously-ish; we poll for the
    //   final REC string.
    await page.click('#caprr-toggle');
    await expect(page.locator('#caprr-status')).toContainText(/^REC \d+:\d{2} \/ /, {
      timeout: 5_000,
    });

    // Button label flipped to "Stop" so the user can end the take.
    await expect(page.locator('#caprr-toggle')).toHaveText('Stop');
  });
});
