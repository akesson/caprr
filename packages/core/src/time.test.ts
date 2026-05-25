import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecorderState } from './state';
import { initialState } from './state';
import { makeTimeSource } from './time';
import type { RrwebPlayer } from './types';

/**
 * `makeTimeSource` is a thin pane-aware shim over a <video> element
 * and an rrweb Replayer instance. These tests stub both sides and
 * assert each public method routes correctly.
 *
 * Phase 6.1 replaced the Svelte rrweb-player wrapper with the
 * Replayer class directly — `player.goto(tMs, false)` became
 * `player.pause(tMs)`, and `getCurrentTime`/`getMirror`/`iframe`
 * live on the player itself rather than under `getReplayer()`.
 */

const mountVideo = (currentSec = 0): HTMLVideoElement => {
  const v = document.createElement('video');
  v.id = 'caprr-video';
  let cur = currentSec;
  Object.defineProperty(v, 'currentTime', {
    get: () => cur,
    set: (n: number) => {
      cur = n;
    },
    configurable: true,
  });
  v.pause = vi.fn();
  document.body.appendChild(v);
  return v;
};

const makeFakePlayer = (
  currentMs = 0,
): RrwebPlayer & {
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  getCurrentTime: ReturnType<typeof vi.fn>;
  getMirror: ReturnType<typeof vi.fn>;
} => ({
  iframe: document.createElement('iframe'),
  pause: vi.fn(),
  play: vi.fn(),
  destroy: vi.fn(),
  getCurrentTime: vi.fn(() => currentMs),
  getMirror: vi.fn(),
});

const stateWith = (
  overrides: Partial<RecorderState> = {},
): RecorderState => ({
  ...initialState(),
  ...overrides,
});

let video: HTMLVideoElement | null = null;

beforeEach(() => {
  // no-op
});

afterEach(() => {
  if (video) {
    video.remove();
    video = null;
  }
});

describe('TimeSource.current', () => {
  it('reads the video element\'s currentTime (in ms) when pane is "video"', () => {
    video = mountVideo(1.234);
    const s = stateWith({ activePane: 'video' });
    const time = makeTimeSource(s);
    expect(time.current).toBe(1234);
  });

  it('reads player.getCurrentTime() when pane is "dom"', () => {
    const player = makeFakePlayer(2_500);
    const s = stateWith({ activePane: 'dom', player });
    const time = makeTimeSource(s);
    expect(time.current).toBe(2_500);
  });

  it('returns 0 on video pane when the video element is missing', () => {
    const s = stateWith({ activePane: 'video' });
    const time = makeTimeSource(s);
    expect(time.current).toBe(0);
  });

  it('returns 0 on dom pane when player is null', () => {
    const s = stateWith({ activePane: 'dom', player: null });
    const time = makeTimeSource(s);
    expect(time.current).toBe(0);
  });

  it('returns 0 on dom pane when getCurrentTime throws', () => {
    const player = makeFakePlayer(0);
    player.getCurrentTime.mockImplementation(() => {
      throw new Error('boom');
    });
    const s = stateWith({ activePane: 'dom', player });
    const time = makeTimeSource(s);
    expect(time.current).toBe(0);
  });
});

describe('TimeSource.seek', () => {
  it('writes video.currentTime in seconds AND calls player.pause(tMs)', () => {
    video = mountVideo(0);
    const player = makeFakePlayer();
    const s = stateWith({ activePane: 'video', player });
    const time = makeTimeSource(s);
    time.seek(3_500);
    expect(video.currentTime).toBeCloseTo(3.5, 5);
    expect(player.pause).toHaveBeenCalledWith(3_500);
  });

  it('pauses the video before seeking', () => {
    video = mountVideo(0);
    const s = stateWith({ activePane: 'video' });
    const time = makeTimeSource(s);
    time.seek(1_000);
    expect(video.pause).toHaveBeenCalled();
  });

  it('is a no-op when neither video nor player is present', () => {
    const s = stateWith({ activePane: 'video', player: null });
    const time = makeTimeSource(s);
    expect(() => time.seek(5_000)).not.toThrow();
  });
});

describe('TimeSource.pause', () => {
  it('pauses both the video and the player', () => {
    video = mountVideo(0);
    const player = makeFakePlayer();
    const s = stateWith({ activePane: 'video', player });
    const time = makeTimeSource(s);
    time.pause();
    expect(video.pause).toHaveBeenCalled();
    expect(player.pause).toHaveBeenCalled();
  });

  it('does not throw when video.pause itself throws', () => {
    video = mountVideo(0);
    (video.pause as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('paused already');
    });
    const s = stateWith({ activePane: 'video' });
    const time = makeTimeSource(s);
    expect(() => time.pause()).not.toThrow();
  });
});
