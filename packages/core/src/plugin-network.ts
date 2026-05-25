/** rrweb plugin that monkey-patches window.fetch and window.XMLHttpRequest
 *  to emit one type-6 (Plugin) event per request with method / url /
 *  status / duration / content-length / content-type — metadata only,
 *  never request or response bodies.
 *
 *  WebSocket is intentionally NOT patched here. Real apps (e.g. the
 *  LeaveDates pusher-interop crate) hot-path WebSocket and we don't want
 *  to risk subtly breaking them.
 *
 *  Patches are scoped to the recording: the observer's returned cleanup
 *  restores the originals when rrweb.record() stops. */

export interface NetworkEventMeta {
  kind: 'fetch' | 'xhr';
  method: string;
  url: string;
  status?: number;
  ok?: boolean;
  redirected?: boolean;
  contentType: string | null;
  contentLength: number | null;
  durationMs: number;
  timestamp: number;
  error?: string;
}

type EmitCb = (data: NetworkEventMeta) => void;

interface RrwebPlugin {
  name: string;
  observer: (cb: EmitCb, win: Window) => () => void;
}

export const buildNetworkPlugin = (): RrwebPlugin => ({
  name: 'rrweb/network@1',
  observer: (cb, win) => {
    const origFetch = win.fetch;
    const OrigXHR = (win as Window & { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest;
    const now = (): number => (win.performance ? win.performance.now() : Date.now());

    win.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const start = now();
      const reqUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : ((input as Request).url ?? '');
      const reqMethod =
        init?.method ?? (typeof input === 'object' && 'method' in input ? (input as Request).method : null) ?? 'GET';
      try {
        const res = await origFetch.call(win, input, init);
        const cl = res.headers.get('content-length');
        cb({
          kind: 'fetch',
          method: reqMethod,
          url: reqUrl,
          status: res.status,
          ok: res.ok,
          redirected: res.redirected,
          contentType: res.headers.get('content-type'),
          contentLength: cl ? parseInt(cl, 10) : null,
          durationMs: Math.round(now() - start),
          timestamp: Date.now(),
        });
        return res;
      } catch (e) {
        cb({
          kind: 'fetch',
          method: reqMethod,
          url: reqUrl,
          contentType: null,
          contentLength: null,
          error: String((e instanceof Error && e.message) || e),
          durationMs: Math.round(now() - start),
          timestamp: Date.now(),
        });
        throw e;
      }
    };

    // XHR: wrap the constructor so each instance's send() is timed and its
    // loadend emits a metadata event. Preserve XHR's static readyState
    // constants so callers that reference XMLHttpRequest.DONE etc still work.
    function PatchedXHR(this: XMLHttpRequest): XMLHttpRequest {
      const xhr = new OrigXHR();
      let m = 'GET';
      let u = '';
      let start = 0;
      const origOpen = xhr.open.bind(xhr);
      xhr.open = function (method: string, url: string | URL, ...rest: unknown[]): void {
        m = method;
        u = typeof url === 'string' ? url : url.toString();
        // The .open signature is variadic-overloaded; cast to any to forward all args.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (origOpen as any)(method, url, ...rest);
      };
      const origSend = xhr.send.bind(xhr);
      xhr.send = function (body?: Document | XMLHttpRequestBodyInit | null): void {
        start = now();
        xhr.addEventListener(
          'loadend',
          () => {
            const lenHeader = xhr.getResponseHeader('content-length') ?? '';
            cb({
              kind: 'xhr',
              method: m,
              url: u,
              status: xhr.status,
              contentType: xhr.getResponseHeader('content-type'),
              contentLength: parseInt(lenHeader, 10) || null,
              durationMs: Math.round(now() - start),
              timestamp: Date.now(),
            });
          },
          { once: true },
        );
        return origSend(body);
      };
      return xhr;
    }
    (['UNSENT', 'OPENED', 'HEADERS_RECEIVED', 'LOADING', 'DONE'] as const).forEach((k) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (PatchedXHR as any)[k] = (OrigXHR as any)[k];
    });
    PatchedXHR.prototype = OrigXHR.prototype;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (win as Window & { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest = PatchedXHR as any;

    return () => {
      win.fetch = origFetch;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (win as Window & { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest = OrigXHR as any;
    };
  },
});
