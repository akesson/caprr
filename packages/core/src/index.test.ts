import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRecorder, VERSION } from './index';
import type { Recorder, RecorderStateChangeDetail } from './types';

describe('createRecorder', () => {
  it('exports a VERSION constant', () => {
    expect(typeof VERSION).toBe('string');
    expect(VERSION.length).toBeGreaterThan(0);
  });

  describe('disabled (no-op) handle', () => {
    let rec: Recorder;

    it('returns a Recorder with EventTarget surface when opts.enabled === false', () => {
      rec = createRecorder({ enabled: false });
      expect(typeof rec.addEventListener).toBe('function');
      expect(typeof rec.removeEventListener).toBe('function');
      expect(typeof rec.dispatchEvent).toBe('function');
    });

    it('has an "idle" state and a no-op lifecycle', async () => {
      rec = createRecorder({ enabled: false });
      expect(rec.state).toBe('idle');
      // None of these should throw.
      await rec.start();
      rec.stop();
      rec.discard();
      await rec.save();
      rec.destroy();
      expect(rec.state).toBe('idle');
    });

    it('accepts an addEventListener subscription that never fires', () => {
      rec = createRecorder({ enabled: false });
      const seen: unknown[] = [];
      rec.addEventListener('statechange', (e) => seen.push(e));
      // No transitions happen on a no-op handle.
      expect(seen).toEqual([]);
    });
  });

  // jsdom ships neither MediaRecorder nor getDisplayMedia, so calling
  // createRecorder({}) here exercises the feature-detect fallback path.
  // End-to-end statechange firing is asserted by the Playwright suite
  // (lifecycle.spec.ts) where a real browser supplies those APIs.
  describe('feature-detect fallback (browser lacks MediaRecorder/getDisplayMedia)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns a no-op handle (does not throw) when MediaRecorder is undefined', () => {
      // jsdom default: MediaRecorder is undefined. The fallback should
      // engage without us needing to mock anything.
      expect((globalThis as { MediaRecorder?: unknown }).MediaRecorder).toBeUndefined();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const rec = createRecorder({});
      try {
        expect(rec.state).toBe('idle');
        expect(typeof rec.addEventListener).toBe('function');
        // Lifecycle methods are wired as no-ops.
        expect(rec.start).toBeInstanceOf(Function);
        // One-time warning so consumers debugging missing UI see why.
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toMatch(/MediaRecorder|getDisplayMedia/);
        // Type-only: the detail shape is what consumers will read.
        const _typeProbe: RecorderStateChangeDetail = { from: null, to: 'idle' };
        expect(_typeProbe.to).toBe('idle');
      } finally {
        rec.destroy();
      }
    });

    it('does not mount any DOM nodes when feature-detect short-circuits', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const before = document.body.children.length;
      const rec = createRecorder({});
      try {
        // Real recorder appends #caprr-panel + #caprr-overlay; no-op
        // handle must not touch the document.
        expect(document.body.children.length).toBe(before);
        expect(document.getElementById('caprr-panel')).toBeNull();
        expect(document.getElementById('caprr-overlay')).toBeNull();
      } finally {
        rec.destroy();
      }
    });
  });
});
