/** State machine + lifecycle. Connects state, time source, UI, plugins,
 *  save flow, and annotations into a single coherent `Recorder`. */

import { record } from 'rrweb';
import RrwebPlayerCtor from 'rrweb-player';
import { getRecordConsolePlugin } from '@rrweb/rrweb-plugin-console-record';
import 'rrweb-player/dist/style.css';
import './styles.css';

import { addNote, installNoteDrag, renderAnnotations } from './annotations';
import { extForMime, pickMime } from './codec';
import { installPillDrag, restorePillPos } from './pill-drag';
import { buildErrorsPlugin } from './plugin-errors';
import { buildNetworkPlugin } from './plugin-network';
import {
  buildSidecar,
  gzipBytes,
  saveBlob,
  tsName,
  type SidecarPayloadV3,
} from './save';
import { fullCleanup, initialState } from './state';
import { makeTimeSource, type TimeSource } from './time';
import type { CreateRecorderOptions, Recorder, RecorderStateName, RrwebPlayer } from './types';
import { createOverlay, createPill } from './ui';
import { $, fmt, fmtBytes } from './util';

const MAX_RECORDING_MS_DEFAULT = 5 * 60 * 1000;
const TIMESLICE_MS = 250;
const RRWEB_PLAYER_CONTROLLER_H = 80;

/** All the pieces wired together. Returns a public `Recorder` handle. */
export const createRecorderImpl = (opts: CreateRecorderOptions): Recorder => {
  const s = initialState();
  const time: TimeSource = makeTimeSource(s);
  const maxRecordingMs = opts.maxRecordingMs ?? MAX_RECORDING_MS_DEFAULT;
  const captureNetwork = opts.captureNetwork ?? true;
  const captureConsole = opts.captureConsole ?? true;
  const captureErrors = opts.captureErrors ?? true;

  // --- UI ---------------------------------------------------------------
  const pill = createPill();
  const overlay = createOverlay();
  document.body.appendChild(overlay);
  document.body.appendChild(pill);

  const applyState = (): void => {
    const p = $('caprr-panel');
    const o = $('caprr-overlay');
    if (p) p.setAttribute('data-caprr-state', s.state);
    if (o) o.setAttribute('data-caprr-state', s.state);
    const toggle = $('caprr-toggle');
    const status = $('caprr-status');
    if (s.state === 'idle') {
      if (toggle) {
        toggle.textContent = 'Start Recording';
        (toggle as HTMLButtonElement).disabled = false;
      }
      if (status) status.textContent = 'Idle';
    } else if (s.state === 'starting') {
      if (toggle) {
        toggle.textContent = 'Pick a screen…';
        (toggle as HTMLButtonElement).disabled = true;
      }
      if (status) status.textContent = 'Waiting for share';
    } else if (s.state === 'recording') {
      if (toggle) {
        toggle.textContent = 'Stop';
        (toggle as HTMLButtonElement).disabled = false;
      }
      // tick() refreshes status text every 500 ms
    } else if (s.state === 'reviewing') {
      if (toggle) {
        toggle.textContent = 'Start Recording';
        (toggle as HTMLButtonElement).disabled = false;
      }
      if (status) status.textContent = 'Reviewing';
    }
  };

  const tick = (): void => {
    if (s.state !== 'recording') return;
    const el = $('caprr-status');
    if (el) el.textContent = 'REC ' + fmt(Date.now() - s.startedAt) + ' / ' + fmt(maxRecordingMs);
  };
  const startTicker = (): void => {
    if (s.tickHandle) return;
    tick();
    s.tickHandle = setInterval(tick, 500);
  };
  const stopTicker = (): void => {
    if (s.tickHandle) {
      clearInterval(s.tickHandle);
      s.tickHandle = null;
    }
  };

  // --- Pane toggle ------------------------------------------------------
  const showPane = (which: 'video' | 'dom'): void => {
    s.activePane = which;
    const stage = $('caprr-stage');
    if (stage) stage.setAttribute('data-pane', which);
    const vBtn = $('caprr-pane-video');
    const dBtn = $('caprr-pane-dom');
    if (vBtn) vBtn.setAttribute('aria-pressed', which === 'video' ? 'true' : 'false');
    if (dBtn) dBtn.setAttribute('aria-pressed', which === 'dom' ? 'true' : 'false');
    renderAnnotations(s, time);
  };
  const switchPane = (which: 'video' | 'dom'): void => {
    if (s.state !== 'reviewing' || s.activePane === which) return;
    const t = time.current;
    time.seek(t);
    showPane(which);
  };

  // --- Open the review overlay -----------------------------------------
  const openReview = (): void => {
    const host = $('caprr-player');
    const vid = $<HTMLVideoElement>('caprr-video');
    const stage = $('caprr-stage');
    if (!host || !vid || !stage) {
      console.warn('[caprr] review DOM missing');
      return;
    }
    host.innerHTML = '';
    s.annotations = [];
    if (s.videoBlob) {
      s.videoUrl = URL.createObjectURL(s.videoBlob);
      vid.src = s.videoUrl;
    }
    s.state = 'reviewing';
    applyState();
    const stageRect = stage.getBoundingClientRect();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const PlayerCtor = ((RrwebPlayerCtor as any).default ?? RrwebPlayerCtor) as new (args: unknown) => RrwebPlayer;
    s.player = new PlayerCtor({
      target: host,
      props: {
        events: s.events,
        autoPlay: false,
        showController: true,
        width: Math.max(320, Math.floor(stageRect.width)),
        height: Math.max(120, Math.floor(stageRect.height) - RRWEB_PLAYER_CONTROLLER_H),
      },
    });
    vid.addEventListener('timeupdate', () => {
      if (s.activePane === 'video') renderAnnotations(s, time);
    });
    try {
      if (s.player && typeof s.player.addEventListener === 'function') {
        s.player.addEventListener('ui-update-current-time', () => {
          if (s.activePane === 'dom') renderAnnotations(s, time);
        });
      }
    } catch (e) {
      console.warn('[caprr] player.addEventListener failed', e);
    }
    let lastDomTick = -1;
    const domTick = (): void => {
      if (s.state !== 'reviewing') return;
      if (s.activePane === 'dom') {
        const t = time.current;
        if (t !== lastDomTick) {
          lastDomTick = t;
          renderAnnotations(s, time);
        }
      }
      requestAnimationFrame(domTick);
    };
    requestAnimationFrame(domTick);
    time.seek(0);
    showPane('video');
    const elapsed = s.events.length
      ? (s.events[s.events.length - 1]?.timestamp ?? 0) - (s.events[0]?.timestamp ?? 0)
      : 0;
    const oStat = $('caprr-overlay-status');
    if (oStat && s.videoBlob) {
      oStat.textContent =
        fmt(elapsed) + ' · ' + s.events.length + ' events · ' + fmtBytes(s.videoBlob.size) + ' video';
    }
  };

  const teardownPlayer = (): void => {
    try {
      if (s.player && s.player.$destroy) s.player.$destroy();
    } catch {
      // noop
    }
    s.player = null;
    const host = $('caprr-player');
    if (host) host.innerHTML = '';
    const vid = $<HTMLVideoElement>('caprr-video');
    if (vid) {
      try {
        vid.pause();
      } catch {
        // noop
      }
      vid.removeAttribute('src');
      vid.load();
    }
    const layer = $('caprr-annot-layer');
    if (layer) layer.innerHTML = '';
    s.annotations = [];
    s.activePane = 'video';
    const stage = $('caprr-stage');
    if (stage) stage.setAttribute('data-pane', 'video');
  };

  // --- Lifecycle --------------------------------------------------------
  const start = async (): Promise<void> => {
    if (s.state !== 'idle') return;
    s.state = 'starting';
    applyState();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...({ displaySurface: 'browser' } as any),
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({
          preferCurrentTab: true,
          selfBrowserSurface: 'include',
          surfaceSwitching: 'exclude',
          monitorTypeSurfaces: 'exclude',
          systemAudio: 'exclude',
        } as any),
      } as MediaStreamConstraints);
    } catch (e) {
      console.warn('[caprr] screen capture cancelled or denied', e);
      s.state = 'idle';
      applyState();
      return;
    }
    s.stream = stream;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (s.state === 'recording') stop();
    });

    s.videoMime = pickMime();
    s.videoChunks = [];
    try {
      s.recorder = new MediaRecorder(stream, s.videoMime ? { mimeType: s.videoMime } : undefined);
    } catch (e) {
      console.warn('[caprr] MediaRecorder construction failed', e);
      fullCleanup(s);
      s.state = 'idle';
      applyState();
      return;
    }
    s.recorder.ondataavailable = (e): void => {
      if (e.data && e.data.size > 0) s.videoChunks.push(e.data);
    };

    await new Promise<void>((res) => {
      s.recorder?.addEventListener('start', () => res(), { once: true });
      s.recorder?.start(TIMESLICE_MS);
    });

    s.events = [];
    s.startedAt = Date.now();
    s.recording = {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
      },
    };

    const plugins: unknown[] = [];
    if (captureConsole) plugins.push(getRecordConsolePlugin());
    if (captureNetwork) plugins.push(buildNetworkPlugin());
    if (captureErrors) plugins.push(buildErrorsPlugin());

    s.stopFn = record({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      emit: (e: any) => s.events.push(e),
      recordCanvas: true,
      collectFonts: true,
      blockSelector: '#caprr-panel,#caprr-overlay',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      plugins: plugins as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any) ?? null;
    s.state = 'recording';
    applyState();
    startTicker();
    s.autoStopHandle = setTimeout(() => {
      stop();
    }, maxRecordingMs);
  };

  const stop = (): void => {
    if (s.state !== 'recording') return;
    if (s.stopFn) {
      s.stopFn();
      s.stopFn = null;
    }
    if (s.autoStopHandle) {
      clearTimeout(s.autoStopHandle);
      s.autoStopHandle = null;
    }
    stopTicker();
    const finalizeVideo = (): void => {
      if (s.stream) {
        s.stream.getTracks().forEach((t) => t.stop());
        s.stream = null;
      }
      const ext = extForMime(s.videoMime);
      s.videoBlob = new Blob(s.videoChunks, { type: s.videoMime || 'video/' + ext });
      if (s.events.length < 2 || s.videoBlob.size === 0) {
        s.events = [];
        fullCleanup(s);
        s.state = 'idle';
        applyState();
        return;
      }
      openReview();
    };
    if (s.recorder && s.recorder.state !== 'inactive') {
      s.recorder.addEventListener('stop', finalizeVideo, { once: true });
      s.recorder.stop();
    } else {
      finalizeVideo();
    }
  };

  const discard = (): void => {
    if (s.state !== 'reviewing') return;
    teardownPlayer();
    s.events = [];
    fullCleanup(s);
    s.state = 'idle';
    applyState();
  };

  const save = async (): Promise<void> => {
    if (s.state !== 'reviewing') return;
    if (!s.videoBlob) return;
    const ext = extForMime(s.videoMime);
    const payload: SidecarPayloadV3 = {
      v: 3,
      recording: s.recording,
      events: s.events,
      annotations: s.annotations,
    };
    const compressed = await gzipBytes(new TextEncoder().encode(JSON.stringify(payload)));
    const sidecar = buildSidecar(compressed, ext === 'mp4' ? 'mp4' : 'webm');
    const finalBlob = new Blob([s.videoBlob as BlobPart, sidecar as BlobPart], {
      type: s.videoMime || 'video/' + ext,
    });
    const name = tsName(ext);
    if (opts.onSave) {
      await opts.onSave(finalBlob, {
        name,
        viewport: s.recording?.viewport ?? { width: 0, height: 0, dpr: 1 },
        annotationCount: s.annotations.length,
      });
    } else {
      const result = await saveBlob(finalBlob, name);
      if (result === 'cancelled') return;
    }
    teardownPlayer();
    s.events = [];
    fullCleanup(s);
    s.state = 'idle';
    applyState();
  };

  // --- Event delegation (capture phase) --------------------------------
  // Dioxus and other frameworks delegate clicks at the root and may
  // consume bubbling events before they reach button.onclick. Capture
  // phase runs first, so this fires regardless of host framework.
  const pillDrag = installPillDrag();
  const cleanupNoteDrag = installNoteDrag(s, time);

  const onClick = (e: MouseEvent): void => {
    if (pillDrag.swallowNextClick.value) {
      e.stopPropagation();
      e.preventDefault();
      pillDrag.swallowNextClick.value = false;
      return;
    }
    const t = e.target as HTMLElement | null;
    if (!t || !t.id) return;
    if (!t.id.startsWith('caprr-')) return;
    const id = t.id;
    if (id === 'caprr-toggle') {
      e.stopPropagation();
      e.preventDefault();
      if (s.state === 'idle') void start();
      else if (s.state === 'recording') stop();
    } else if (id === 'caprr-save') {
      e.stopPropagation();
      e.preventDefault();
      void save();
    } else if (id === 'caprr-discard') {
      e.stopPropagation();
      e.preventDefault();
      discard();
    } else if (id === 'caprr-add-note') {
      e.stopPropagation();
      e.preventDefault();
      addNote(s, time);
    } else if (id === 'caprr-pane-video') {
      e.stopPropagation();
      e.preventDefault();
      switchPane('video');
    } else if (id === 'caprr-pane-dom') {
      e.stopPropagation();
      e.preventDefault();
      switchPane('dom');
    }
  };
  document.addEventListener('click', onClick, true);

  // Restore the pill's last-known position (if any) once it's in the DOM.
  restorePillPos();
  applyState();

  // --- Public API ------------------------------------------------------
  return {
    start,
    stop,
    discard,
    save,
    destroy(): void {
      try {
        if (s.stopFn) s.stopFn();
      } catch {
        // noop
      }
      if (s.autoStopHandle) clearTimeout(s.autoStopHandle);
      stopTicker();
      teardownPlayer();
      fullCleanup(s);
      document.removeEventListener('click', onClick, true);
      pillDrag.destroy();
      cleanupNoteDrag();
      pill.remove();
      overlay.remove();
      s.state = 'idle';
    },
    get state(): RecorderStateName {
      return s.state;
    },
  };
};
