/** rrweb plugin: capture resource-fetch metadata via
 *  `PerformanceObserver({type:'resource', buffered:true})`. Unlike the
 *  previous fetch+XHR monkey-patch implementation, this hooks no globals
 *  and captures EVERY resource the page loads — fetch, XHR, images,
 *  stylesheets, scripts, fonts, beacons, video, audio.
 *
 *  Trade-offs versus the monkey-patch approach:
 *
 *  - WIN: no instance / prototype mutation. Host apps that observe
 *    `XMLHttpRequest`'s identity or wrap `window.fetch` themselves are
 *    no longer at risk of being broken.
 *  - WIN: breadth — img/css/script/font/beacon all observable.
 *  - LOSS: PerformanceResourceTiming does not expose the request
 *    METHOD. Everything is recorded without a method; consumers should
 *    treat GET as the default.
 *  - LOSS: it also doesn't expose `Content-Type`. We get sizes and
 *    `initiatorType` but not the served MIME.
 *  - LOSS: failures (TypeError, AbortError, CORS rejections) do not
 *    produce a resource entry, so the previous `.error` field on the
 *    event is gone. The plugin is silent on failed loads.
 *
 *  Bumped plugin name from `rrweb/network@1` (the monkey-patch era) to
 *  `rrweb/network@2` so sidecar readers can distinguish payload shapes.
 *  An older reader that only knew @1 still sees the @2 events as
 *  type-6 with a recognizable plugin name — it can opt to skip them or
 *  upcast its decoder. */

export interface NetworkEventMetaV2 {
  /** Broader than the @1 enum — covers all PerformanceObserver
   *  initiator types we may see in the wild. */
  kind:
    | 'fetch'
    | 'xmlhttprequest'
    | 'img'
    | 'css'
    | 'script'
    | 'font'
    | 'video'
    | 'audio'
    | 'beacon'
    | 'other';
  url: string;
  /** Optional — PerformanceResourceTiming.responseStatus is Chromium 109+,
   *  Safari 17+, Firefox 128+. Below those versions it's undefined. */
  status?: number;
  /** Bytes over the wire including headers. 0 for cache hits / CORS-tainted. */
  transferSize: number | null;
  /** Body bytes as encoded (e.g. gzipped). */
  encodedBodySize: number | null;
  /** Body bytes as decoded by the browser. */
  decodedBodySize: number | null;
  durationMs: number;
  /** Wall-clock ms (Date.now()-equivalent) computed from
   *  `performance.timeOrigin + entry.startTime`. */
  timestamp: number;
}

/** Back-compat alias for callers still importing the old name. */
export type NetworkEventMeta = NetworkEventMetaV2;

type EmitCb = (data: NetworkEventMetaV2) => void;

interface RrwebPlugin {
  name: string;
  observer: (cb: EmitCb, win: Window) => () => void;
}

/** Public for test reach-in. Maps PerformanceResourceTiming.initiatorType
 *  (a wide, browser-dependent string) onto the discriminated `kind`
 *  enum. Unknown values fold to `'other'`. */
export const mapInitiatorType = (it: string): NetworkEventMetaV2['kind'] => {
  switch (it) {
    case 'fetch':
    case 'xmlhttprequest':
    case 'img':
    case 'css':
    case 'script':
    case 'font':
    case 'video':
    case 'audio':
    case 'beacon':
      return it;
    // Some browsers report 'link' for <link rel="stylesheet">; collapse.
    case 'link':
      return 'css';
    default:
      return 'other';
  }
};

/** Public for test reach-in. Turn a single entry into our shape. */
export const toMeta = (entry: PerformanceResourceTiming, win: Window): NetworkEventMetaV2 => {
  // entry.startTime is high-resolution time since performance.timeOrigin.
  // Compose with timeOrigin to get a real wall-clock value.
  const origin = win.performance?.timeOrigin ?? 0;
  const status =
    'responseStatus' in entry && typeof (entry as { responseStatus?: number }).responseStatus === 'number'
      ? (entry as { responseStatus: number }).responseStatus
      : undefined;
  return {
    kind: mapInitiatorType(entry.initiatorType),
    url: entry.name,
    ...(status !== undefined ? { status } : {}),
    transferSize: Number.isFinite(entry.transferSize) ? entry.transferSize : null,
    encodedBodySize: Number.isFinite(entry.encodedBodySize) ? entry.encodedBodySize : null,
    decodedBodySize: Number.isFinite(entry.decodedBodySize) ? entry.decodedBodySize : null,
    durationMs: Math.round(entry.duration),
    timestamp: Math.round(origin + entry.startTime),
  };
};

export const buildNetworkPlugin = (): RrwebPlugin => ({
  name: 'rrweb/network@2',
  observer: (cb, win) => {
    const POCtor = (win as Window & { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver;
    if (typeof POCtor !== 'function') {
      // Host doesn't implement PerformanceObserver — silently no-op.
      // The support floor (Chromium 111 / FF 110 / Safari 17) guarantees
      // this branch should never fire in production, but a defensive
      // bailout is cheaper than a runtime crash if the floor moves.
      return () => {};
    }
    const po = new POCtor((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType !== 'resource') continue;
        cb(toMeta(entry as PerformanceResourceTiming, win));
      }
    });
    // `buffered: true` replays entries from before the observer attached,
    // so a recording started a few ms after page load still sees the
    // initial document subresources.
    po.observe({ type: 'resource', buffered: true });
    return () => po.disconnect();
  },
});
