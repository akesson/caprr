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
    // rrweb-player 1.0.0-alpha.4 doesn't expose getCurrentTime on the
    // Svelte wrapper — the method lives on the underlying Replayer.
    if (s.player && typeof s.player.getReplayer === 'function') {
      try {
        const r = s.player.getReplayer();
        if (r && typeof r.getCurrentTime === 'function') {
          return Math.round(r.getCurrentTime() || 0);
        }
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
    if (s.player && typeof s.player.goto === 'function') {
      try {
        s.player.goto(tMs, false);
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
