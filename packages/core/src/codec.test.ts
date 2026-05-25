import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIME_CANDIDATES, extForMime, pickMime } from './codec';

/**
 * jsdom does not ship MediaRecorder. Tests stub
 * `globalThis.MediaRecorder.isTypeSupported` per case so we drive the
 * negotiation against a known set of "supported" mimes.
 *
 * These tests intentionally lock the CURRENT VP9-first priority. Phase 1.4
 * of the modernization plan reorders the list (AV1-preferring with VP9
 * fallback); when that change lands, this file is updated alongside it.
 * Until then the locking is the regression net.
 */
const stubMediaRecorderWith = (supported: Set<string>): void => {
  vi.stubGlobal('MediaRecorder', {
    isTypeSupported: (mime: string) => supported.has(mime),
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MIME_CANDIDATES (current priority — pre-1.4)', () => {
  it('keeps WebM/VP9 ahead of MP4/H.264', () => {
    expect(MIME_CANDIDATES[0]).toBe('video/webm;codecs=vp9,opus');
    const vp9Idx = MIME_CANDIDATES.indexOf('video/webm;codecs=vp9' as (typeof MIME_CANDIDATES)[number]);
    const mp4Idx = MIME_CANDIDATES.indexOf('video/mp4;codecs=avc1' as (typeof MIME_CANDIDATES)[number]);
    expect(vp9Idx).toBeGreaterThan(-1);
    expect(mp4Idx).toBeGreaterThan(vp9Idx);
  });
});

describe('pickMime', () => {
  it('returns the first candidate the host claims support for', () => {
    stubMediaRecorderWith(new Set(MIME_CANDIDATES));
    expect(pickMime()).toBe(MIME_CANDIDATES[0]);
  });

  it('skips earlier candidates if unsupported and lands on the first supported one', () => {
    stubMediaRecorderWith(new Set(['video/webm', 'video/mp4']));
    expect(pickMime()).toBe('video/webm');
  });

  it('falls all the way through to MP4 when only MP4 is supported (Safari-like)', () => {
    stubMediaRecorderWith(new Set(['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4']));
    expect(pickMime()).toBe('video/mp4;codecs=avc1,mp4a.40.2');
  });

  it('returns the empty string when nothing is supported', () => {
    stubMediaRecorderWith(new Set());
    expect(pickMime()).toBe('');
  });

  it('handles a host that only knows WebM/VP9 (Firefox-like)', () => {
    stubMediaRecorderWith(new Set(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm']));
    expect(pickMime()).toBe('video/webm;codecs=vp9,opus');
  });
});

describe('extForMime', () => {
  it('maps video/mp4 variants to mp4', () => {
    expect(extForMime('video/mp4')).toBe('mp4');
    expect(extForMime('video/mp4;codecs=avc1')).toBe('mp4');
    expect(extForMime('video/mp4;codecs=avc1,mp4a.40.2')).toBe('mp4');
  });

  it('maps video/webm variants to webm', () => {
    expect(extForMime('video/webm')).toBe('webm');
    expect(extForMime('video/webm;codecs=vp9')).toBe('webm');
    expect(extForMime('video/webm;codecs=vp9,opus')).toBe('webm');
  });

  it('defaults the empty string (and unknown mimes) to webm', () => {
    expect(extForMime('')).toBe('webm');
    expect(extForMime('application/octet-stream')).toBe('webm');
  });
});
