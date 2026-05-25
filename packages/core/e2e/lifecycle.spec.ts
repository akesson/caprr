import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { installCanvasGetDisplayMediaStub, installNotAllowedStub } from './fixtures';

/** Playwright's bundled WebKit on Linux (used in CI) ships without
 *  MediaRecorder. Real Safari has it (17.4+ on Apple platforms), so
 *  the test gap is in the test runtime, not the product.
 *
 *  createRecorder() feature-detects MediaRecorder + getDisplayMedia
 *  and returns a no-op handle on unsupported browsers — that handle
 *  never mounts the pill or overlay, so every test in this file
 *  (lifecycle, cancel-path, destroy) needs to skip when the API
 *  is absent. */
const skipIfNoMediaRecorder = async (page: Page): Promise<void> => {
  const hasMR = await page.evaluate(() => typeof MediaRecorder !== 'undefined');
  test.skip(!hasMR, 'browser lacks MediaRecorder (Playwright WebKit on Linux)');
};

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
    await skipIfNoMediaRecorder(page);

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
    await skipIfNoMediaRecorder(page);

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
    await skipIfNoMediaRecorder(page);

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

    // The saved Blob's .type reflects the codec the browser actually
    // negotiated. Phase 1.4 made the MIME list AV1-preferring with a
    // VP9 fallback; we assert the regression contract — no legacy H.264
    // / avc1 — and that the type starts with video/.
    const blobType = await page.evaluate(() => {
      const b = (window as unknown as { __caprrLastSavedBlob?: Blob }).__caprrLastSavedBlob;
      return b?.type ?? null;
    });
    expect(blobType).toBeTruthy();
    expect(blobType!).toMatch(/^video\/(webm|mp4)/);
    expect(blobType!).not.toMatch(/avc1/);
    expect(blobType!).toMatch(/av01|vp9|webm$|mp4$/);
  });

  test('discard from review returns recorder to idle', async ({ page }) => {
    await installCanvasGetDisplayMediaStub(page);
    await page.goto('/');
    await skipIfNoMediaRecorder(page);

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
    // createRecorder feature-detects: on browsers without MediaRecorder
    // it returns a no-op handle that never mounts the pill, so there's
    // no UI to drive the cancel-path assertions against.
    await skipIfNoMediaRecorder(page);

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

  test('PerformanceObserver captures fetch + img + script + style in the sidecar', async ({ page }) => {
    await installCanvasGetDisplayMediaStub(page);
    await page.goto('/?test=1');
    await skipIfNoMediaRecorder(page);

    await page.click('#caprr-toggle');
    await expect(page.locator('#caprr-status')).toContainText(/^REC /, { timeout: 5_000 });

    // Trigger four distinct initiator types. These are issued AFTER the
    // observer attaches; `buffered: true` would also include pre-record
    // resources but we don't rely on that here.
    await page.evaluate(async () => {
      // 1. fetch
      try {
        await fetch('/no-such-resource-fetch');
      } catch {
        // ok — even a 404 produces a PerformanceResourceTiming
      }

      // 2. img — append and await load (or error; both record)
      await new Promise<void>((resolve) => {
        const img = document.createElement('img');
        img.src = '/no-such-resource-img.png';
        img.onload = () => resolve();
        img.onerror = () => resolve();
        document.body.appendChild(img);
      });

      // 3. script
      await new Promise<void>((resolve) => {
        const s = document.createElement('script');
        s.src = '/no-such-resource-script.js';
        s.onload = () => resolve();
        s.onerror = () => resolve();
        document.head.appendChild(s);
      });

      // 4. css via <link rel="stylesheet">
      await new Promise<void>((resolve) => {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = '/no-such-resource.css';
        l.onload = () => resolve();
        l.onerror = () => resolve();
        document.head.appendChild(l);
      });
    });

    // Let the PerformanceObserver flush.
    await page.waitForTimeout(400);
    await page.click('#caprr-toggle');
    await expect(page.locator('#caprr-overlay')).toHaveAttribute('data-caprr-state', 'reviewing', {
      timeout: 10_000,
    });
    await page.click('#caprr-save');
    await expect(page.locator('#caprr-status')).toHaveText('Idle', { timeout: 10_000 });

    const summary = await page.evaluate(async () => {
      const b = (window as unknown as { __caprrLastSavedBlob?: Blob }).__caprrLastSavedBlob;
      if (!b) return { ok: false, reason: 'no blob' } as const;
      const buf = new Uint8Array(await b.arrayBuffer());
      const marker = new TextEncoder().encode('rrwebspd-events!');
      let idx = -1;
      outer: for (let i = 0; i <= buf.length - marker.length; i++) {
        for (let j = 0; j < marker.length; j++) {
          if (buf[i + j] !== marker[j]) continue outer;
        }
        idx = i + marker.length;
        break;
      }
      if (idx < 0) return { ok: false, reason: 'no marker' } as const;
      const gz = buf.slice(idx);
      const stream = new Response(gz).body!.pipeThrough(new DecompressionStream('gzip'));
      const dec = new Uint8Array(await new Response(stream).arrayBuffer());
      const payload = JSON.parse(new TextDecoder().decode(dec)) as {
        events: { type: number; data: unknown }[];
      };
      const netEvents = payload.events.filter(
        (e) =>
          e.type === 6 &&
          typeof e.data === 'object' &&
          e.data !== null &&
          'plugin' in e.data &&
          (e.data as { plugin?: unknown }).plugin === 'rrweb/network@2',
      );
      const kinds = new Set(
        netEvents.map(
          (e) => (e.data as { payload?: { kind?: string } }).payload?.kind ?? null,
        ),
      );
      return { ok: true, count: netEvents.length, kinds: [...kinds] } as const;
    });

    expect(summary.ok, !summary.ok ? summary.reason : '').toBe(true);
    if (summary.ok) {
      expect(summary.count).toBeGreaterThan(0);
      // We expect at least three of: fetch, img, script, css.
      // Different browsers may attribute differently (e.g. WebKit can label
      // the canvas-capture-stream init as `other`); assert breadth, not
      // an exact set.
      const seen = new Set(summary.kinds);
      const expectedKinds = ['fetch', 'img', 'script', 'css'] as const;
      const matched = expectedKinds.filter((k) => seen.has(k));
      expect(
        matched.length,
        `expected at least 3 of fetch/img/script/css; saw kinds=${JSON.stringify(summary.kinds)}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  test('window error during recording lands in the sidecar as a plugin event', async ({ page }) => {
    await installCanvasGetDisplayMediaStub(page);
    await page.goto('/?test=1');
    await skipIfNoMediaRecorder(page);

    await page.click('#caprr-toggle');
    await expect(page.locator('#caprr-status')).toContainText(/^REC /, { timeout: 5_000 });

    // Dispatch a synthetic error so the test doesn't depend on Playwright's
    // error-handling for thrown exceptions (it can fail the test on uncaught
    // errors). The plugin listens for the 'error' event regardless of origin.
    await page.evaluate(() => {
      window.dispatchEvent(
        new ErrorEvent('error', {
          message: 'e2e probe boom',
          filename: 'e2e-test',
          lineno: 1,
          colno: 1,
        }),
      );
    });

    await page.waitForTimeout(400);
    await page.click('#caprr-toggle');
    await expect(page.locator('#caprr-overlay')).toHaveAttribute('data-caprr-state', 'reviewing', {
      timeout: 10_000,
    });
    await page.click('#caprr-save');
    await expect(page.locator('#caprr-status')).toHaveText('Idle', { timeout: 10_000 });

    const found = await page.evaluate(async () => {
      const b = (window as unknown as { __caprrLastSavedBlob?: Blob }).__caprrLastSavedBlob;
      if (!b) return { ok: false, reason: 'no blob' };
      const buf = new Uint8Array(await b.arrayBuffer());

      // Scan for "rrwebspd-events!"
      const marker = new TextEncoder().encode('rrwebspd-events!');
      let idx = -1;
      outer: for (let i = 0; i <= buf.length - marker.length; i++) {
        for (let j = 0; j < marker.length; j++) {
          if (buf[i + j] !== marker[j]) continue outer;
        }
        idx = i + marker.length;
        break;
      }
      if (idx < 0) return { ok: false, reason: 'no marker' };

      // Gunzip the payload and parse the JSON.
      const gz = buf.slice(idx);
      const stream = new Response(gz).body!.pipeThrough(new DecompressionStream('gzip'));
      const decompressed = new Uint8Array(await new Response(stream).arrayBuffer());
      const payload = JSON.parse(new TextDecoder().decode(decompressed)) as {
        events: { type: number; data: unknown }[];
      };

      // Plugin events are type 6; data shape is { plugin: string, payload: unknown }.
      const errorEvents = payload.events.filter(
        (e) =>
          e.type === 6 &&
          typeof e.data === 'object' &&
          e.data !== null &&
          'plugin' in e.data &&
          (e.data as { plugin?: unknown }).plugin === 'rrweb/errors@1',
      );
      const messages = errorEvents.map(
        (e) => ((e.data as { payload?: { message?: string } }).payload?.message) ?? null,
      );
      return { ok: true, count: errorEvents.length, messages };
    });

    expect(found.ok, found.ok ? '' : found.reason).toBe(true);
    expect(found.count).toBeGreaterThan(0);
    expect(found.messages).toContain('e2e probe boom');
  });

  test('Recorder dispatches "statechange" events with {from, to} detail', async ({ page }) => {
    await installCanvasGetDisplayMediaStub(page);
    await page.goto('/');
    await skipIfNoMediaRecorder(page);

    // Attach a listener early. The recorder mounts during page load; we
    // miss the initial null → idle but every subsequent transition is
    // captured.
    await page.evaluate(() => {
      const w = window as unknown as {
        __caprr: EventTarget;
        __caprrTransitions: { from: string | null; to: string }[];
      };
      w.__caprrTransitions = [];
      w.__caprr.addEventListener('statechange', (e) => {
        const detail = (e as CustomEvent).detail as { from: string | null; to: string };
        w.__caprrTransitions.push(detail);
      });
    });

    await page.click('#caprr-toggle');
    await expect(page.locator('#caprr-status')).toContainText(/^REC /, { timeout: 5_000 });
    await page.waitForTimeout(500);
    await page.click('#caprr-toggle');
    await expect(page.locator('#caprr-overlay')).toHaveAttribute('data-caprr-state', 'reviewing', {
      timeout: 10_000,
    });
    await page.click('#caprr-discard');
    await expect(page.locator('#caprr-status')).toHaveText('Idle');

    const transitions = await page.evaluate(
      () =>
        (window as unknown as { __caprrTransitions: { from: string | null; to: string }[] })
          .__caprrTransitions,
    );

    // Order: idle → starting → recording → reviewing → idle
    expect(transitions.map((t) => t.to)).toEqual(['starting', 'recording', 'reviewing', 'idle']);
    expect(transitions[0]!.from).toBe('idle');
    expect(transitions[1]!.from).toBe('starting');
    expect(transitions[2]!.from).toBe('recording');
    expect(transitions[3]!.from).toBe('reviewing');
  });

  test('destroy() removes the pill and the overlay from the document', async ({ page }) => {
    await installCanvasGetDisplayMediaStub(page);
    await page.goto('/');
    // No pill/overlay is mounted when the no-op handle is returned.
    await skipIfNoMediaRecorder(page);

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
