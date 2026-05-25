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

/** Construct and mount a recorder. When `opts.enabled === false` returns
 *  a no-op handle so callers can safely instantiate it in production.
 *  The no-op still extends EventTarget so addEventListener calls don't
 *  throw on consumers that subscribe unconditionally. */
export const createRecorder = (opts: CreateRecorderOptions = {}): Recorder => {
  if (opts.enabled === false) {
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
