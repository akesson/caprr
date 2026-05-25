import { expect, test } from './fixtures';
import { installCanvasGetDisplayMediaStub, installNotAllowedStub } from './fixtures';

/** Bytes spelling "rrwebspd-events!" — the marker the sidecar reader scans for. */
const SIDECAR_MARKER = new Uint8Array([
  0x72, 0x72, 0x77, 0x65, 0x62, 0x73, 0x70, 0x64,
  0x2d, 0x65, 0x76, 0x65, 0x6e, 0x74, 0x73, 0x21,
]);

/** Linear scan for the marker. Returns -1 if absent. */
const findMarkerOffset = (haystack: Uint8Array): number => {
  outer: for (let i = 0; i <= haystack.length - SIDECAR_MARKER.length; i++) {
    for (let j = 0; j < SIDECAR_MARKER.length; j++) {
      if (haystack[i + j] !== SIDECAR_MARKER[j]) continue outer;
    }
    return i;
  }
  return -1;
};

test.describe('recorder lifecycle (canvas-stream stub)', () => {
  test('transitions from Idle → REC … on toggle click', async ({ page }) => {
    await installCanvasGetDisplayMediaStub(page);
    await page.goto('/');

    await expect(page.locator('#caprr-status')).toHaveText('Idle');
    await page.click('#caprr-toggle');
    await expect(page.locator('#caprr-status')).toContainText(/^REC \d+:\d{2} \/ /, {
      timeout: 5_000,
    });
    await expect(page.locator('#caprr-toggle')).toHaveText('Stop');
  });

  test('full record → stop → review opens the overlay with summary text', async ({ page }) => {
    await installCanvasGetDisplayMediaStub(page);
    await page.goto('/');

    await page.click('#caprr-toggle');
    await expect(page.locator('#caprr-status')).toContainText(/^REC /, { timeout: 5_000 });

    // Let rrweb accumulate a few events and MediaRecorder produce a chunk.
    await page.waitForTimeout(1_200);
    await page.click('#caprr-toggle');

    // Review overlay enters the "reviewing" state.
    const overlay = page.locator('#caprr-overlay');
    await expect(overlay).toHaveAttribute('data-caprr-state', 'reviewing', { timeout: 10_000 });
    await expect(page.locator('#caprr-overlay-status')).toContainText(/events/, { timeout: 5_000 });
    await expect(page.locator('#caprr-toggle')).toHaveText('Start Recording');
  });

  test('save (in test mode) produces a Blob with the sidecar marker', async ({ page }) => {
    await installCanvasGetDisplayMediaStub(page);
    await page.goto('/?test=1');

    await page.click('#caprr-toggle');
    await expect(page.locator('#caprr-status')).toContainText(/^REC /, { timeout: 5_000 });
    await page.waitForTimeout(1_200);
    await page.click('#caprr-toggle');
    await expect(page.locator('#caprr-overlay')).toHaveAttribute('data-caprr-state', 'reviewing', {
      timeout: 10_000,
    });

    await page.click('#caprr-save');

    // After save, the recorder returns to idle and the example has
    // populated window.__caprrLastSavedBlob via the onSave callback.
    await expect(page.locator('#caprr-status')).toHaveText('Idle', { timeout: 10_000 });

    const bytes = await page.evaluate(async () => {
      const b = (window as unknown as { __caprrLastSavedBlob?: Blob }).__caprrLastSavedBlob;
      if (!b) return null;
      const buf = await b.arrayBuffer();
      return Array.from(new Uint8Array(buf));
    });

    expect(bytes, 'expected onSave to have stashed a Blob on window').not.toBeNull();
    const buf = new Uint8Array(bytes!);
    expect(buf.byteLength).toBeGreaterThan(SIDECAR_MARKER.byteLength);

    const markerOffset = findMarkerOffset(buf);
    expect(markerOffset, 'sidecar marker bytes ("rrwebspd-events!") must appear in the saved file').toBeGreaterThan(-1);

    // The saved video bytes must precede the marker (it's appended, not prepended).
    expect(markerOffset).toBeGreaterThan(0);

    const meta = await page.evaluate(
      () =>
        (window as unknown as { __caprrLastSavedMeta?: { name: string; viewport: unknown; annotationCount: number } }).__caprrLastSavedMeta,
    );
    expect(meta?.name).toMatch(/^caprr-\d{8}-\d{6}\.(webm|mp4)$/);
    expect(meta?.annotationCount).toBe(0);
  });

  test('discard from review returns recorder to idle', async ({ page }) => {
    await installCanvasGetDisplayMediaStub(page);
    await page.goto('/');

    await page.click('#caprr-toggle');
    await expect(page.locator('#caprr-status')).toContainText(/^REC /, { timeout: 5_000 });
    await page.waitForTimeout(1_200);
    await page.click('#caprr-toggle');
    await expect(page.locator('#caprr-overlay')).toHaveAttribute('data-caprr-state', 'reviewing', {
      timeout: 10_000,
    });

    await page.click('#caprr-discard');
    await expect(page.locator('#caprr-status')).toHaveText('Idle');
    await expect(page.locator('#caprr-overlay')).toHaveAttribute('data-caprr-state', 'idle');
  });

  test('cancel path: NotAllowedError keeps state idle and never opens the overlay', async ({
    page,
  }) => {
    await installNotAllowedStub(page);
    await page.goto('/');

    await expect(page.locator('#caprr-status')).toHaveText('Idle');
    await page.click('#caprr-toggle');

    // The recorder transitions idle → starting → (getDisplayMedia rejects) → idle.
    // Poll for the round-trip — under heavy parallel load WebKit can take >500ms
    // to settle, and a fixed waitForTimeout flakes.
    await expect(page.locator('#caprr-toggle')).toHaveText('Start Recording', {
      timeout: 5_000,
    });
    await expect(page.locator('#caprr-status')).toHaveText('Idle');
    await expect(page.locator('#caprr-overlay')).toHaveAttribute('data-caprr-state', 'idle');
  });

  test('destroy() removes the pill and the overlay from the document', async ({ page }) => {
    await installCanvasGetDisplayMediaStub(page);
    await page.goto('/');

    await expect(page.locator('#caprr-panel')).toBeAttached();
    await expect(page.locator('#caprr-overlay')).toBeAttached();

    await page.evaluate(() => {
      const rec = (window as unknown as { __caprr?: { destroy: () => void } }).__caprr;
      rec?.destroy();
    });

    await expect(page.locator('#caprr-panel')).toHaveCount(0);
    await expect(page.locator('#caprr-overlay')).toHaveCount(0);
  });
});
