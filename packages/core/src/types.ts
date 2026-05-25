/** Shared types for caprr. Where upstream rrweb @rrweb/types already
 *  ships a precise definition, we re-export it for consumers who want
 *  to interact with rrweb events directly. The local interfaces below
 *  are kept narrow on purpose — caprr only treats events as opaque
 *  push-and-serialize records. */

// Upstream rrweb event types (re-exported for consumers that want the
// precise discriminated union — Phase 8.2 of the modernization plan).
export type { eventWithTime, EventType } from '@rrweb/types';

/** A single rrweb event after it's been emitted by the recorder. The full
 *  rrweb event union is `eventWithTime` (re-exported above); this is the
 *  structural minimum caprr uses internally for serialization. */
export interface RrwebEvent {
  type: number;
  timestamp: number;
  data: unknown;
}

/** The slice of the rrweb `Replayer` surface caprr depends on. This used
 *  to be a Svelte wrapper (`rrweb-player` 1.0.0-alpha.4) — Phase 6.1
 *  swapped that out for the underlying Replayer from `rrweb` directly,
 *  removing a Svelte runtime dependency and the CJS/ESM interop hack. */
export interface RrwebPlayer {
  play(timeOffset?: number): void;
  pause(timeOffset?: number): void;
  getCurrentTime(): number;
  getMirror(): RrwebMirror;
  destroy(): void;
  iframe: HTMLIFrameElement;
}

/** Alias kept for backward import compatibility with internal callers. */
export type RrwebReplayer = RrwebPlayer;

/** The Mirror keeps a numeric id ↔ Node mapping for the rebuilt DOM. */
export interface RrwebMirror {
  getId(node: Node | null): number;
  getNode(id: number): Node | null;
}

/** Viewport at recording start — needed to map pixel anchors back into
 *  CSS coordinates inside the rebuilt iframe. */
export interface Viewport {
  width: number;
  height: number;
  dpr: number;
}

/** DOM anchor attached to an annotation when authoring lands on a real
 *  DOM element. The rrweb_node_id is authoritative; the selector is the
 *  human-readable fallback / display hint. */
export interface AnnotationDom {
  selector: string | null;
  rrweb_node_id: number | null;
  tag: string | null;
}

/** A single annotation. Pixel anchor is always present (the click point
 *  on the stage, normalized 0..1). The DOM anchor is best-effort and may
 *  be null for clicks that don't hit a recorded DOM element. */
export interface Annotation {
  id: string;
  /** ms from the recording's first event timestamp */
  t_start: number;
  /** ms; null = "open ended" (visible from t_start to end of recording) */
  t_end: number | null;
  pixel: { x: number; y: number };
  dom: AnnotationDom | null;
  text: string;
}

export type RecorderStateName = 'idle' | 'starting' | 'recording' | 'reviewing';
export type ActivePane = 'video' | 'dom';

/** Public configuration accepted by createRecorder(). */
export interface CreateRecorderOptions {
  /** Skip mounting entirely when false. Default: true. */
  enabled?: boolean;
  /** Auto-stop after this many ms. Default: 5 * 60 * 1000. */
  maxRecordingMs?: number;
  /** Monkey-patch fetch + XHR to capture request metadata. Default: true. */
  captureNetwork?: boolean;
  /** Load the rrweb console plugin. Default: true. */
  captureConsole?: boolean;
  /** Capture window 'error' + 'unhandledrejection' as plugin events. Default: true. */
  captureErrors?: boolean;
  /** Video encoder pipeline. Default 'mediarecorder' (broad compatibility,
   *  AV1 on Chrome 116+, VP9 on Firefox, H.264 on Safari). 'webcodecs' uses
   *  Mediabunny's WebCodecs `VideoEncoder` for AV1-preferring hardware
   *  encoding; falls back to MediaRecorder when WebCodecs is unavailable. */
  encoder?: 'mediarecorder' | 'webcodecs';
  /** Optional Region Capture: when set to 'self' or an Element, crops
   *  the captured stream to that element via `CropTarget.fromElement`.
   *  Chromium-only (Chrome 104+); on browsers without CropTarget the
   *  setting is silently ignored. Default 'fullTab' (no crop). */
  captureRegion?: 'fullTab' | 'self' | Element;
  /** Pass through to rrweb.record({ recordCanvas }). Default `false`:
   *  capturing canvas content is expensive (large incremental
   *  snapshots, frequent emits) and surprises consumers whose apps
   *  use a few small canvases for icons / sparklines but do not need
   *  pixel replay. Opt in when the recorded app genuinely needs DOM
   *  canvas state preserved across the rrweb replay. */
  recordCanvas?: boolean;
  /** Optional sink for the saved Blob. If omitted, the file is downloaded. */
  onSave?: (blob: Blob, meta: { name: string; viewport: Viewport; annotationCount: number }) => Promise<void> | void;
}

/** `'statechange'` event detail dispatched by Recorder on every transition. */
export interface RecorderStateChangeDetail {
  /** Previous state, or null on the very first dispatch (initial → idle). */
  from: RecorderStateName | null;
  to: RecorderStateName;
}

/** Returned by createRecorder. Stable handle for the lifetime of the page.
 *  Extends EventTarget; subscribe to `'statechange'` for transition notifications:
 *
 *     rec.addEventListener('statechange', (e) => {
 *       const detail = (e as CustomEvent<RecorderStateChangeDetail>).detail;
 *       console.log(detail.from, '→', detail.to);
 *     });
 */
export interface Recorder extends EventTarget {
  start(): Promise<void>;
  stop(): void;
  discard(): void;
  save(): Promise<void>;
  destroy(): void;
  readonly state: RecorderStateName;
}
