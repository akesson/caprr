import { afterEach, describe, expect, it, vi } from 'vitest';
import { openRecordingSink } from './storage';

/**
 * jsdom has no OPFS. The capable-path is exercised under Playwright
 * (lifecycle.spec.ts) where Chromium / Firefox / WebKit ship real
 * `navigator.storage.getDirectory()`. Here we exercise the fallback
 * (no `storage` on navigator) and the OPFS-detect-but-fail branches.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openRecordingSink — in-memory fallback', () => {
  it('reports backend "memory" when navigator.storage is missing', async () => {
    // jsdom navigator has no `storage` property by default.
    const sink = await openRecordingSink();
    expect(sink.backend).toBe('memory');
  });

  it('accumulates chunks and finalizes them as a single Blob', async () => {
    const sink = await openRecordingSink();
    await sink.writeChunk(new Blob([new Uint8Array([1, 2, 3])]));
    await sink.writeChunk(new Blob([new Uint8Array([4, 5])]));
    const out = await sink.finalize('video/webm');
    expect(out.type).toBe('video/webm');
    expect(out.size).toBe(5);
  });

  it('dispose() clears the accumulator', async () => {
    const sink = await openRecordingSink();
    await sink.writeChunk(new Blob([new Uint8Array([7, 8, 9])]));
    await sink.dispose();
    // After dispose, finalize on the same sink yields an empty blob.
    const out = await sink.finalize('video/webm');
    expect(out.size).toBe(0);
  });
});

describe('openRecordingSink — OPFS detect-but-fail', () => {
  it('falls back to in-memory if getDirectory rejects', async () => {
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      storage: {
        getDirectory: () => Promise.reject(new Error('opfs unavailable')),
      },
    });
    const sink = await openRecordingSink();
    expect(sink.backend).toBe('memory');
  });

  it('falls back to in-memory if createWritable is missing on the file handle', async () => {
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      storage: {
        getDirectory: async () => ({
          getFileHandle: async () => ({
            // no createWritable — emulates Firefox 110 without writable streams
          }),
        }),
      },
    });
    const sink = await openRecordingSink();
    expect(sink.backend).toBe('memory');
  });
});
