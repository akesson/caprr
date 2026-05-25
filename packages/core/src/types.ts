/** Shared types for caprr. rrweb itself doesn't ship .d.ts in this alpha
 *  version, so we declare the slice of its surface we actually use here. */

/** A single rrweb event after it's been emitted by the recorder. The full
 *  rrweb event union is large; we just need to push and serialize them. */
export interface RrwebEvent {
  type: number;
  timestamp: number;
  data: unknown;
}

/** The Svelte-wrapper player exposes a small public API on top of the
 *  underlying Replayer. We only call the bits listed here. */
export interface RrwebPlayer {
  goto(timeMs: number, play?: boolean): void;
  pause(): void;
  play(): void;
  getReplayer(): RrwebReplayer | undefined;
  addEventListener?(name: string, handler: () => void): void;
  $destroy?: () => void;
}

/** The underlying Replayer (rebuilds the DOM into an iframe). */
export interface RrwebReplayer {
  iframe: HTMLIFrameElement;
  getMirror?: () => RrwebMirror;
  getCurrentTime?: () => number;
}

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
