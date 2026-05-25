import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkEventMetaV2 } from './plugin-network';
import { buildNetworkPlugin, mapInitiatorType, toMeta } from './plugin-network';

/**
 * Phase 2.1 replaces the previous fetch+XHR monkey-patch with a
 * PerformanceObserver-based design. jsdom does not implement
 * PerformanceObserver, so these tests:
 *
 *   1. Unit-test the pure helpers (mapInitiatorType, toMeta) directly
 *      against synthetic PerformanceResourceTiming-shaped objects.
 *   2. Stub PerformanceObserver on a fake `win` to verify the observer
 *      wires up correctly and the cleanup disconnects.
 *
 * End-to-end "every initiator type lands in the sidecar" is locked by
 * the Playwright suite (lifecycle.spec.ts).
 */

describe('mapInitiatorType', () => {
  it('passes through the documented initiator types unchanged', () => {
    for (const it of [
      'fetch',
      'xmlhttprequest',
      'img',
      'css',
      'script',
      'font',
      'video',
      'audio',
      'beacon',
    ] as const) {
      expect(mapInitiatorType(it)).toBe(it);
    }
  });

  it('collapses "link" → "css"', () => {
    expect(mapInitiatorType('link')).toBe('css');
  });

  it('folds unknown initiator types to "other"', () => {
    expect(mapInitiatorType('navigation')).toBe('other');
    expect(mapInitiatorType('xslt')).toBe('other');
    expect(mapInitiatorType('')).toBe('other');
  });
});

describe('toMeta', () => {
  /** Build a PerformanceResourceTiming-shaped object with sensible defaults. */
  const entry = (
    overrides: Partial<PerformanceResourceTiming> & { responseStatus?: number } = {},
  ): PerformanceResourceTiming =>
    ({
      name: 'https://example.test/x',
      entryType: 'resource',
      initiatorType: 'fetch',
      startTime: 100,
      duration: 250.7,
      transferSize: 1500,
      encodedBodySize: 1000,
      decodedBodySize: 4000,
      ...overrides,
    }) as unknown as PerformanceResourceTiming;

  const winWith = (timeOrigin: number): Window =>
    ({
      performance: { timeOrigin },
    }) as unknown as Window;

  it('maps URL, kind, durationMs, sizes, and computes timestamp from origin', () => {
    const out = toMeta(entry(), winWith(1_700_000_000_000));
    const expected: NetworkEventMetaV2 = {
      kind: 'fetch',
      url: 'https://example.test/x',
      transferSize: 1500,
      encodedBodySize: 1000,
      decodedBodySize: 4000,
      durationMs: 251,
      timestamp: 1_700_000_000_100,
    };
    expect(out).toEqual(expected);
  });

  it('includes status when the entry carries responseStatus (Chromium 109+, Safari 17+, FF 128+)', () => {
    const out = toMeta(entry({ responseStatus: 404 }), winWith(0));
    expect(out.status).toBe(404);
  });

  it('omits status when responseStatus is undefined (FF 110-127, older Safari)', () => {
    const out = toMeta(entry(), winWith(0));
    expect('status' in out).toBe(false);
  });

  it('coerces non-finite sizes to null', () => {
    const out = toMeta(
      entry({
        transferSize: NaN as unknown as number,
        encodedBodySize: Infinity as unknown as number,
        decodedBodySize: -Infinity as unknown as number,
      }),
      winWith(0),
    );
    expect(out.transferSize).toBeNull();
    expect(out.encodedBodySize).toBeNull();
    expect(out.decodedBodySize).toBeNull();
  });

  it('maps non-fetch initiator types correctly', () => {
    expect(toMeta(entry({ initiatorType: 'img' }), winWith(0)).kind).toBe('img');
    expect(toMeta(entry({ initiatorType: 'script' }), winWith(0)).kind).toBe('script');
    expect(toMeta(entry({ initiatorType: 'link' }), winWith(0)).kind).toBe('css');
  });
});

describe('buildNetworkPlugin shape + wiring', () => {
  it('returns the rrweb-plugin shape with name "rrweb/network@2"', () => {
    const plug = buildNetworkPlugin();
    expect(plug.name).toBe('rrweb/network@2');
    expect(typeof plug.observer).toBe('function');
  });

  /** Synthetic PerformanceObserver that captures the constructor's
   *  callback so tests can fire entries through it on demand. */
  class FakePO {
    static lastCallback:
      | ((list: { getEntries: () => PerformanceResourceTiming[] }) => void)
      | null = null;
    static disconnectCount = 0;
    constructor(cb: (list: { getEntries: () => PerformanceResourceTiming[] }) => void) {
      FakePO.lastCallback = cb;
    }
    observe(_opts: PerformanceObserverInit): void {
      // no-op
    }
    disconnect(): void {
      FakePO.disconnectCount += 1;
    }
  }

  beforeEach(() => {
    FakePO.lastCallback = null;
    FakePO.disconnectCount = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('attaches a PerformanceObserver and emits one event per resource entry', () => {
    const win = {
      PerformanceObserver: FakePO,
      performance: { timeOrigin: 0 },
    } as unknown as Window;
    const events: NetworkEventMetaV2[] = [];
    const cleanup = buildNetworkPlugin().observer((e) => events.push(e), win);
    expect(FakePO.lastCallback).not.toBeNull();
    FakePO.lastCallback!({
      getEntries: () => [
        {
          name: 'https://api.test/a',
          entryType: 'resource',
          initiatorType: 'fetch',
          startTime: 0,
          duration: 100,
          transferSize: 100,
          encodedBodySize: 80,
          decodedBodySize: 200,
        } as unknown as PerformanceResourceTiming,
        {
          name: 'https://cdn.test/x.png',
          entryType: 'resource',
          initiatorType: 'img',
          startTime: 10,
          duration: 50,
          transferSize: 2000,
          encodedBodySize: 1900,
          decodedBodySize: 1900,
        } as unknown as PerformanceResourceTiming,
      ],
    });
    expect(events).toHaveLength(2);
    expect(events[0]!.kind).toBe('fetch');
    expect(events[1]!.kind).toBe('img');
    cleanup();
    expect(FakePO.disconnectCount).toBe(1);
  });

  it('ignores entries that are not resource timings', () => {
    const win = {
      PerformanceObserver: FakePO,
      performance: { timeOrigin: 0 },
    } as unknown as Window;
    const events: NetworkEventMetaV2[] = [];
    const cleanup = buildNetworkPlugin().observer((e) => events.push(e), win);
    FakePO.lastCallback!({
      getEntries: () => [
        {
          name: 'navigation-1',
          entryType: 'navigation',
          initiatorType: 'navigation',
          startTime: 0,
          duration: 0,
        } as unknown as PerformanceResourceTiming,
      ],
    });
    expect(events).toHaveLength(0);
    cleanup();
  });

  it('is a silent no-op when PerformanceObserver is unavailable', () => {
    const win = {} as unknown as Window;
    const events: NetworkEventMetaV2[] = [];
    const cleanup = buildNetworkPlugin().observer((e) => events.push(e), win);
    expect(typeof cleanup).toBe('function');
    expect(() => cleanup()).not.toThrow();
    expect(events).toHaveLength(0);
  });
});
