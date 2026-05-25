import type { WebCodecsEncoderHandle } from './encoder-webcodecs';
import type { EventsSink, RecordingSink } from './storage';
import type {
  ActivePane,
  Annotation,
  RecorderStateName,
  RrwebEvent,
  RrwebPlayer,
  Viewport,
} from './types';

/** Mutable state object passed by reference through the recorder. The JS
 *  spike used a `window.__rrwebSpike` global for this; we keep it as a
 *  per-recorder instance so multiple recorders could in principle coexist
 *  (though only one is mounted in practice). */
export interface RecorderState {
  /** Lifecycle state — see RecorderStateName. */
  state: RecorderStateName;
  /** rrweb events accumulated since the recording started. After a
   *  stop+finalize this is the read-back from the EventsSink; during
   *  recording it stays empty (events live in the sink). */
  events: RrwebEvent[];
  /** Per-recording events sink (NDJSON-on-OPFS or in-memory). Active
   *  only during 'recording'; nulled after finalize materializes the
   *  events into `events`. */
  eventsSink: EventsSink | null;
  /** Returned by `rrweb.record()` — call to stop recording. */
  stopFn: (() => void) | null;
  /** ms wall-clock at recording start. Used for the elapsed ticker only. */
  startedAt: number;
  /** rrweb-player instance constructed at review time. */
  player: RrwebPlayer | null;
  /** Observes the review stage for size changes so annotation positions
   *  follow window resize / DPR change. Lives only during reviewing. */
  stageResizeObserver: ResizeObserver | null;
  /** Auto-stop timer. */
  autoStopHandle: ReturnType<typeof setTimeout> | null;
  /** Display ticker (refreshes the REC mm:ss in the pill). */
  tickHandle: ReturnType<typeof setInterval> | null;
  // --- pixel video capture ----------------------------------------------
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  /** Optional WebCodecs-backed encoder handle (used when opts.encoder
   *  === 'webcodecs' and the host supports it). When set, `recorder`
   *  is null — they are mutually exclusive. */
  webCodecsEncoder: WebCodecsEncoderHandle | null;
  /** OPFS-backed (or in-memory fallback) sink that receives every
   *  encoded chunk (from either MediaRecorder or the WebCodecs path).
   *  Owned for the duration of one recording; replaced on each start(). */
  recordingSink: RecordingSink | null;
  videoMime: string;
  videoBlob: Blob | null;
  videoUrl: string | null;
  // --- review-time -------------------------------------------------------
  /** Viewport at recording start. Needed to map pixel↔CSS for DOM resolution. */
  recording: { viewport: Viewport } | null;
  activePane: ActivePane;
  annotations: Annotation[];
}

export const initialState = (): RecorderState => ({
  state: 'idle',
  events: [],
  eventsSink: null,
  stopFn: null,
  startedAt: 0,
  player: null,
  stageResizeObserver: null,
  autoStopHandle: null,
  tickHandle: null,
  stream: null,
  recorder: null,
  webCodecsEncoder: null,
  recordingSink: null,
  videoMime: '',
  videoBlob: null,
  videoUrl: null,
  recording: null,
  activePane: 'video',
  annotations: [],
});

/** Convenience: drop all transient resources (stream tracks, blob URLs,
 *  OPFS temp files) without touching annotations or events. Called
 *  from S.discard and S.start on a failed setup. */
export const fullCleanup = (s: RecorderState): void => {
  if (s.stream) {
    s.stream.getTracks().forEach((t) => t.stop());
    s.stream = null;
  }
  s.recorder = null;
  if (s.webCodecsEncoder) {
    void s.webCodecsEncoder.abort();
    s.webCodecsEncoder = null;
  }
  if (s.recordingSink) {
    // Best-effort dispose; do not block. dispose() removes the OPFS
    // temp file (no-op for the in-memory fallback).
    void s.recordingSink.dispose();
    s.recordingSink = null;
  }
  if (s.eventsSink) {
    void s.eventsSink.dispose();
    s.eventsSink = null;
  }
  s.videoBlob = null;
  if (s.videoUrl) {
    URL.revokeObjectURL(s.videoUrl);
    s.videoUrl = null;
  }
};
