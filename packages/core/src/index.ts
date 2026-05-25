/**
 * caprr — capture + rrweb.
 *
 * Drop-in DOM session recorder for the browser. Captures rrweb DOM events
 * alongside a pixel video of the tab, lets the reviewer annotate moments
 * and regions, and saves the whole bundle as a single .webm file with an
 * EBML Void sidecar carrying the structured data.
 *
 * Minimal usage:
 *
 *     import { createRecorder } from 'caprr';
 *     createRecorder({ enabled: import.meta.env.DEV });
 *
 * The recorder injects its own floating pill + review overlay into the
 * page. Styles are imported by the recorder module itself; no separate
 * CSS import needed.
 */

import { createRecorderImpl } from './recorder';
import type { CreateRecorderOptions, Recorder } from './types';

export const VERSION = '0.1.0';

/** True iff the browser exposes the APIs the recorder needs at runtime.
 *  Missing either of these means `start()` would either throw or stall
 *  forever (e.g. Playwright's bundled WebKit on Linux ships no
 *  MediaRecorder, and our `pickMime()` would ReferenceError when called
 *  from inside the start flow). Used by `createRecorder` to short-circuit
 *  to a no-op handle. */
const isRecorderSupported = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (typeof MediaRecorder === 'undefined') return false;
  const md = (navigator as Navigator & { mediaDevices?: MediaDevices }).mediaDevices;
  if (!md || typeof md.getDisplayMedia !== 'function') return false;
  return true;
};

/** A handle that satisfies the Recorder contract without mounting any UI
 *  or holding any resources. Returned both when the consumer opts out
 *  (`enabled: false`) and when the host browser is missing the APIs the
 *  recorder needs. EventTarget surface is preserved so unconditional
 *  `addEventListener` calls don't throw. */
const noopRecorder = (): Recorder => {
  const noop = new EventTarget() as EventTarget & Partial<Recorder>;
  noop.start = async () => {};
  noop.stop = () => {};
  noop.discard = () => {};
  noop.save = async () => {};
  noop.destroy = () => {};
  Object.defineProperty(noop, 'state', {
    get: () => 'idle' as const,
    enumerable: true,
  });
  return noop as Recorder;
};

/** Construct and mount a recorder. Returns a no-op handle when:
 *  - the consumer opts out via `enabled: false`, or
 *  - the browser lacks `MediaRecorder` or `getDisplayMedia` (in which
 *    case a single warning is logged so a missing recorder isn't a
 *    silent surprise to consumers debugging in unusual environments).
 *
 *  The no-op extends EventTarget so consumers that subscribe
 *  unconditionally never see a thrown call. */
export const createRecorder = (opts: CreateRecorderOptions = {}): Recorder => {
  if (opts.enabled === false) return noopRecorder();
  if (!isRecorderSupported()) {
    console.warn(
      '[caprr] browser lacks MediaRecorder or getDisplayMedia; createRecorder returning no-op handle',
    );
    return noopRecorder();
  }
  return createRecorderImpl(opts);
};

export type {
  Annotation,
  AnnotationDom,
  CreateRecorderOptions,
  Recorder,
  RecorderStateName,
  ActivePane,
  Viewport,
} from './types';
export { RRWEB_UUID } from './save';
export { computeSelector } from './annotations';
