import { afterEach, describe, expect, it, vi } from 'vitest';
import { $, fmt, fmtBytes, newId } from './util';

describe('fmt', () => {
  it('formats 0 ms as 0:00', () => {
    expect(fmt(0)).toBe('0:00');
  });

  it('rounds down to the nearest whole second', () => {
    expect(fmt(1999)).toBe('0:01');
  });

  it('zero-pads seconds', () => {
    expect(fmt(9_000)).toBe('0:09');
  });

  it('rolls over to minutes', () => {
    expect(fmt(60_000)).toBe('1:00');
    expect(fmt(65_000)).toBe('1:05');
  });

  it('handles >10 minutes', () => {
    expect(fmt(10 * 60_000 + 30_000)).toBe('10:30');
  });

  it('clamps negative input to 0:00', () => {
    expect(fmt(-1)).toBe('0:00');
    expect(fmt(-9_999)).toBe('0:00');
  });
});

describe('fmtBytes', () => {
  it('renders sub-KB as bytes', () => {
    expect(fmtBytes(0)).toBe('0 B');
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(1023)).toBe('1023 B');
  });

  it('renders sub-MB as KB with one decimal', () => {
    expect(fmtBytes(1024)).toBe('1.0 KB');
    expect(fmtBytes(1536)).toBe('1.5 KB');
  });

  it('renders ≥1 MB with two decimals', () => {
    expect(fmtBytes(1024 * 1024)).toBe('1.00 MB');
    expect(fmtBytes(5 * 1024 * 1024 + 100 * 1024)).toMatch(/^5\.\d{2} MB$/);
  });
});

describe('newId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns crypto.randomUUID() when available', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'stub-uuid-1' });
    expect(newId()).toBe('stub-uuid-1');
  });

  it('falls back to a non-empty string when randomUUID is missing', () => {
    vi.stubGlobal('crypto', {});
    const id = newId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('returns distinct ids across calls', () => {
    const a = newId();
    const b = newId();
    expect(a).not.toBe(b);
  });
});

describe('$', () => {
  it('returns the element when present', () => {
    const el = document.createElement('div');
    el.id = 'caprr-test-target';
    document.body.appendChild(el);
    try {
      expect($('caprr-test-target')).toBe(el);
    } finally {
      el.remove();
    }
  });

  it('returns null when absent', () => {
    expect($('caprr-missing-id-xyz')).toBeNull();
  });
});
