import { test as base, type Page } from '@playwright/test';

/**
 * Stubs `navigator.mediaDevices.getDisplayMedia` to return a stream
 * driven by a 640×360 canvas (`captureStream(30)`). Downstream code —
 * real MediaRecorder, real codec negotiation, real Blob assembly,
 * real sidecar embedding — runs untouched.
 *
 * Source: CLAUDE.md → Testing → "stub" block. The recorder reads
 * `getDisplayMedia` lazily (on the Start click), so injecting via
 * `addInitScript` is plenty early.
 */
const CANVAS_STREAM_STUB = `
(() => {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  let f = 0;
  setInterval(() => {
    ctx.fillStyle = 'hsl(' + ((f * 7) % 360) + ', 80%, 50%)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.font = '20px sans-serif';
    ctx.fillText('frame ' + f++, 20, 60);
  }, 33);

  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
  }
  navigator.mediaDevices.getDisplayMedia = async () => canvas.captureStream(30);
})();
`;

export const installCanvasGetDisplayMediaStub = async (page: Page): Promise<void> => {
  await page.addInitScript(CANVAS_STREAM_STUB);
};

/** Throws NotAllowedError instead of returning a stream — exercises
 *  the user-cancelled-the-picker path in recorder.ts:start. */
const NOT_ALLOWED_STUB = `
(() => {
  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
  }
  navigator.mediaDevices.getDisplayMedia = async () => {
    throw new DOMException('user denied', 'NotAllowedError');
  };
})();
`;

export const installNotAllowedStub = async (page: Page): Promise<void> => {
  await page.addInitScript(NOT_ALLOWED_STUB);
};

export const test = base.extend({});
export { expect } from '@playwright/test';
