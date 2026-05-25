import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIME_CANDIDATES, extForMime, pickMime } from './codec';

/**
 * jsdom does not ship MediaRecorder. Tests stub
 * `globalThis.MediaRecorder.isTypeSupported` per case so we drive the
 * negotiation against a known set of "supported" mimes.
 *
 * The list is AV1-preferring with a VP9 fallback (Phase 1.4 of the
 * modernization plan). Chrome/Edge land on AV1, Firefox lands on VP9,
 * Safari lands on whatever it supports — all three play in any of
 * those codecs above the documented browser-support floor.
 */
const stubMediaRecorderWith = (supported: Set<string>): void => {
  vi.stubGlobal('MediaRecorder', {
    isTypeSupported: (mime: string) => supported.has(mime),
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MIME_CANDIDATES (AV1-preferring with VP9 fallback)', () => {
  it('puts AV1 entries ahead of VP9', () => {
    const av1First = MIME_CANDIDATES.findIndex((c) => c.includes('av01'));
    const vp9First = MIME_CANDIDATES.findIndex((c) => c.includes('vp9'));
    expect(av1First).toBeGreaterThan(-1);
    expect(vp9First).toBeGreaterThan(-1);
    expect(av1First).toBeLessThan(vp9First);
  });

  it('does not include any bare-MP4 / H.264 entries (Chrome-macOS garbled playback)', () => {
    expect(MIME_CANDIDATES).not.toContain('video/mp4');
    expect(MIME_CANDIDATES).not.toContain('video/mp4;codecs=avc1');
    expect(MIME_CANDIDATES.every((c) => !c.includes('avc1'))).toBe(true);
  });
});

describe('pickMime', () => {
  it('prefers AV1 in MP4 when the host claims support for everything (Chrome-like)', () => {
    stubMediaRecorderWith(new Set(MIME_CANDIDATES));
    expect(pickMime()).toBe('video/mp4;codecs=av01.0.04M.08,opus');
  });

  it('lands on AV1 in WebM when MP4/AV1 is unsupported (typical Chrome path)', () => {
    stubMediaRecorderWith(
      new Set([
        'video/webm;codecs=av01,opus',
        'video/webm;codecs=av01',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp9',
        'video/webm',
      ]),
    );
    expect(pickMime()).toBe('video/webm;codecs=av01,opus');
  });

  it('falls back to VP9 when AV1 is unsupported (Firefox path)', () => {
    stubMediaRecorderWith(
      new Set(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm']),
    );
    expect(pickMime()).toBe('video/webm;codecs=vp9,opus');
  });

  it('falls to plain WebM if only that is supported', () => {
    stubMediaRecorderWith(new Set(['video/webm']));
    expect(pickMime()).toBe('video/webm');
  });

  it('returns the empty string when nothing is supported', () => {
    stubMediaRecorderWith(new Set());
    expect(pickMime()).toBe('');
  });
});

describe('extForMime', () => {
  it('maps video/mp4 variants to mp4', () => {
    expect(extForMime('video/mp4;codecs=av01.0.04M.08,opus')).toBe('mp4');
    expect(extForMime('video/mp4;codecs=av01')).toBe('mp4');
  });

  it('maps video/webm variants to webm', () => {
    expect(extForMime('video/webm')).toBe('webm');
    expect(extForMime('video/webm;codecs=vp9')).toBe('webm');
    expect(extForMime('video/webm;codecs=av01,opus')).toBe('webm');
  });

  it('defaults the empty string (and unknown mimes) to webm', () => {
    expect(extForMime('')).toBe('webm');
    expect(extForMime('application/octet-stream')).toBe('webm');
  });
});
