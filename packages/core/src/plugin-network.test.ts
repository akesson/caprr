import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkEventMeta } from './plugin-network';
import { buildNetworkPlugin } from './plugin-network';

/**
 * Locks the CURRENT plugin-network behavior (monkey-patched fetch +
 * XMLHttpRequest constructor swap). Phase 2.1 of the modernization plan
 * rewrites this to PerformanceObserver; when that lands, the suite is
 * updated alongside it. Until then this is the regression net.
 */

interface FakeWindow {
  fetch: typeof globalThis.fetch;
  XMLHttpRequest: typeof XMLHttpRequest;
  performance?: { now: () => number };
}

const makeWin = (overrides: Partial<FakeWindow> = {}): Window => ({
  fetch: vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response('hi', {
      status: 200,
      headers: {
        'content-type': 'text/plain',
        'content-length': '2',
      },
    }),
  ),
  XMLHttpRequest: makeFakeXHR(),
  performance: { now: () => 0 },
  ...overrides,
}) as unknown as Window;

/** Minimal XHR substitute. Each instance fires `loadend` on the next
 *  microtask after send(), with a canned 200 OK + headers. */
const makeFakeXHR = (): typeof XMLHttpRequest => {
  class FakeXHR {
    static UNSENT = 0;
    static OPENED = 1;
    static HEADERS_RECEIVED = 2;
    static LOADING = 3;
    static DONE = 4;

    status = 0;
    private headers: Record<string, string> = {};
    private listeners: Record<string, ((e?: Event) => void)[]> = {};

    open(_method: string, _url: string | URL): void {
      // no-op; plugin only inspects via its wrapper
    }
    send(_body?: unknown): void {
      this.status = 200;
      this.headers['content-length'] = '42';
      this.headers['content-type'] = 'application/json';
      queueMicrotask(() => {
        (this.listeners['loadend'] ?? []).forEach((fn) => fn());
      });
    }
    addEventListener(name: string, cb: (e?: Event) => void, _opts?: { once?: boolean }): void {
      (this.listeners[name] ??= []).push(cb);
    }
    getResponseHeader(name: string): string | null {
      return this.headers[name.toLowerCase()] ?? null;
    }
  }
  return FakeXHR as unknown as typeof XMLHttpRequest;
};

describe('buildNetworkPlugin shape', () => {
  it('returns the rrweb-plugin shape with name "rrweb/network@1"', () => {
    const plug = buildNetworkPlugin();
    expect(plug.name).toBe('rrweb/network@1');
    expect(typeof plug.observer).toBe('function');
  });
});

describe('fetch wrapping', () => {
  let win: Window;
  let cleanup: () => void;
  const events: NetworkEventMeta[] = [];

  beforeEach(() => {
    events.length = 0;
    win = makeWin();
    cleanup = buildNetworkPlugin().observer((e) => events.push(e), win);
  });

  afterEach(() => {
    cleanup();
  });

  it('replaces win.fetch on install', () => {
    const fresh = makeWin();
    const origFetch = fresh.fetch;
    const clean = buildNetworkPlugin().observer(() => {}, fresh);
    expect(fresh.fetch).not.toBe(origFetch);
    clean();
    expect(fresh.fetch).toBe(origFetch);
  });

  it('emits one event per fetch with the documented metadata shape', async () => {
    const res = await win.fetch('/api/x');
    expect(res.status).toBe(200);
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.kind).toBe('fetch');
    expect(e.method).toBe('GET');
    expect(e.url).toBe('/api/x');
    expect(e.status).toBe(200);
    expect(e.ok).toBe(true);
    expect(e.contentType).toBe('text/plain');
    expect(e.contentLength).toBe(2);
    expect(typeof e.durationMs).toBe('number');
    expect(typeof e.timestamp).toBe('number');
  });

  it('captures init.method when provided', async () => {
    await win.fetch('/api/post', { method: 'POST' });
    expect(events[0]!.method).toBe('POST');
  });

  it('extracts URL from a URL object', async () => {
    await win.fetch(new URL('https://example.test/y'));
    expect(events[0]!.url).toBe('https://example.test/y');
  });

  it('extracts URL and method from a Request object', async () => {
    await win.fetch(new Request('https://example.test/z', { method: 'DELETE' }));
    // The plugin reads method from init?.method ?? input.method ?? 'GET'.
    // When passing a Request without a separate init, init?.method is undefined,
    // so it falls back to the Request's own .method.
    expect(events[0]!.url).toBe('https://example.test/z');
    expect(events[0]!.method).toBe('DELETE');
  });

  it('emits an event with .error set when fetch rejects', async () => {
    const failingWin = makeWin({
      fetch: vi.fn(async () => {
        throw new Error('network down');
      }),
    });
    const failEvents: NetworkEventMeta[] = [];
    const clean = buildNetworkPlugin().observer((e) => failEvents.push(e), failingWin);
    await expect(failingWin.fetch('/api/broken')).rejects.toThrow('network down');
    expect(failEvents).toHaveLength(1);
    expect(failEvents[0]!.error).toMatch(/network down/);
    expect(failEvents[0]!.status).toBeUndefined();
    clean();
  });
});

// The DOM Window type does not expose XMLHttpRequest as a property (it lives
// on WindowOrWorkerGlobalScope as a constructor binding). The plugin reads it
// the same way; mirror its cast here for typecheck cleanliness.
type WinWithXHR = Window & { XMLHttpRequest: typeof XMLHttpRequest };

describe('XHR wrapping', () => {
  let win: WinWithXHR;
  let cleanup: () => void;
  const events: NetworkEventMeta[] = [];

  beforeEach(() => {
    events.length = 0;
    win = makeWin() as WinWithXHR;
    cleanup = buildNetworkPlugin().observer((e) => events.push(e), win);
  });

  afterEach(() => {
    cleanup();
  });

  it('replaces win.XMLHttpRequest on install and restores on cleanup', () => {
    const fresh = makeWin() as WinWithXHR;
    const origXHR = fresh.XMLHttpRequest;
    const clean = buildNetworkPlugin().observer(() => {}, fresh);
    expect(fresh.XMLHttpRequest).not.toBe(origXHR);
    clean();
    expect(fresh.XMLHttpRequest).toBe(origXHR);
  });

  it('copies the readyState constants onto the wrapper', () => {
    expect((win.XMLHttpRequest as unknown as { UNSENT: number }).UNSENT).toBe(0);
    expect((win.XMLHttpRequest as unknown as { DONE: number }).DONE).toBe(4);
  });

  it('emits a NetworkEventMeta on loadend with the documented shape', async () => {
    const xhr = new win.XMLHttpRequest();
    xhr.open('PUT', '/api/put');
    xhr.send('body');
    // loadend fires on next microtask in our fake
    await new Promise((r) => queueMicrotask(() => r(undefined)));
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.kind).toBe('xhr');
    expect(e.method).toBe('PUT');
    expect(e.url).toBe('/api/put');
    expect(e.status).toBe(200);
    expect(e.contentType).toBe('application/json');
    expect(e.contentLength).toBe(42);
    expect(typeof e.durationMs).toBe('number');
  });
});
