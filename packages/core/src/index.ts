/**
 * caprr — capture + rrweb.
 *
 * Drop-in DOM session recorder for the browser. Captures rrweb DOM events
 * alongside a pixel video of the tab, lets the reviewer annotate moments
 * and regions, and saves the whole bundle as a single .webm file with an
 * EBML Void sidecar carrying the structured data.
 *
 * Public entry — placeholder while P2 ports the real implementation.
 */

import './styles.css';

export const VERSION = '0.1.0';

export interface CreateRecorderOptions {
  /** Skip mounting when false. Useful for prod-gated dev tools. */
  enabled?: boolean;
  /** Auto-stop the recording after this many milliseconds. Default 5 min. */
  maxRecordingMs?: number;
  /** Capture `fetch` + `XHR` request metadata via monkey-patching. */
  captureNetwork?: boolean;
  /** Capture `console.*` calls via the rrweb console plugin. */
  captureConsole?: boolean;
}

export interface Recorder {
  start(): Promise<void>;
  stop(): void;
  discard(): void;
  save(): Promise<void>;
  destroy(): void;
  readonly state: 'idle' | 'starting' | 'recording' | 'reviewing';
}

/** Stub. The real implementation lands in Phase 2. */
export function createRecorder(_opts: CreateRecorderOptions = {}): Recorder {
  throw new Error('caprr: createRecorder is not implemented yet (P2 ports the spike).');
}
