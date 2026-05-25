import { describe, expect, it } from 'vitest';
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

  // The fully-mounted recorder dispatches transitions via lifecycle
  // methods that require MediaRecorder + getDisplayMedia (jsdom has
  // neither). End-to-end statechange firing is asserted by the Playwright
  // suite (lifecycle.spec.ts) where a real browser supplies those APIs.
  describe('mounted recorder surface (jsdom-safe checks)', () => {
    it('exposes a state getter and EventTarget surface when mounted', () => {
      const rec = createRecorder({});
      try {
        expect(typeof rec.addEventListener).toBe('function');
        expect(typeof rec.removeEventListener).toBe('function');
        expect(typeof rec.dispatchEvent).toBe('function');
        expect(rec.state).toBe('idle');
        // Type-only: the detail shape is what consumers will read.
        const _typeProbe: RecorderStateChangeDetail = { from: null, to: 'idle' };
        expect(_typeProbe.to).toBe('idle');
      } finally {
        rec.destroy();
      }
    });
  });
});
