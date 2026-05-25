import type { RecorderState } from './state';
import { $ } from './util';

/** A single time abstraction hiding which pane is driving. Both panes
 *  get seeked/paused on every move so swapping pane is a free flip —
 *  the destination is already at the right frame.
 *
 *  Returns a snapshot of the API; safe to call repeatedly because the
 *  underlying state object is read each time. */
export interface TimeSource {
  /** Current time in ms from recording start. */
  readonly current: number;
  seek(tMs: number): void;
  pause(): void;
}

export const makeTimeSource = (s: RecorderState): TimeSource => ({
  get current(): number {
    if (s.activePane === 'video') {
      const v = $<HTMLVideoElement>('caprr-video');
      return v ? Math.round((v.currentTime || 0) * 1000) : 0;
    }
    // Phase 6.1 swapped the Svelte rrweb-player wrapper for the
    // underlying Replayer directly, so getCurrentTime lives on s.player.
    if (s.player && typeof s.player.getCurrentTime === 'function') {
      try {
        return Math.round(s.player.getCurrentTime() || 0);
      } catch {
        // fall through
      }
    }
    return 0;
  },
  seek(tMs: number): void {
    const v = $<HTMLVideoElement>('caprr-video');
    if (v) {
      try {
        v.pause();
      } catch {
        /* noop */
      }
      try {
        v.currentTime = tMs / 1000;
      } catch {
        /* noop */
      }
    }
    // Replayer.pause(tMs) seeks and pauses at the given offset — what
    // the Svelte wrapper's player.goto(tMs, false) used to do.
    if (s.player && typeof s.player.pause === 'function') {
      try {
        s.player.pause(tMs);
      } catch {
        /* noop */
      }
    }
  },
  pause(): void {
    const v = $<HTMLVideoElement>('caprr-video');
    if (v) {
      try {
        v.pause();
      } catch {
        /* noop */
      }
    }
    if (s.player && typeof s.player.pause === 'function') {
      try {
        s.player.pause();
      } catch {
        /* noop */
      }
    }
  },
});
