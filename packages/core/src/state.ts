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
  /** rrweb events accumulated since the recording started. */
  events: RrwebEvent[];
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
  videoChunks: Blob[];
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
  stopFn: null,
  startedAt: 0,
  player: null,
  stageResizeObserver: null,
  autoStopHandle: null,
  tickHandle: null,
  stream: null,
  recorder: null,
  videoChunks: [],
  videoMime: '',
  videoBlob: null,
  videoUrl: null,
  recording: null,
  activePane: 'video',
  annotations: [],
});

/** Convenience: drop all transient resources (stream tracks, blob URLs)
 *  without touching annotations or events. Called from S.discard and
 *  S.start on a failed setup. */
export const fullCleanup = (s: RecorderState): void => {
  if (s.stream) {
    s.stream.getTracks().forEach((t) => t.stop());
    s.stream = null;
  }
  s.recorder = null;
  s.videoChunks = [];
  s.videoBlob = null;
  if (s.videoUrl) {
    URL.revokeObjectURL(s.videoUrl);
    s.videoUrl = null;
  }
};
