/** MediaRecorder mime preferences. AV1 first (Chrome 116+ produces AV1
 *  in WebM; Safari 17.4+ can hand back AV1-in-MP4 from some builds);
 *  VP9 second so Firefox negotiates a working codec (Mozilla bug
 *  1561121, "Enable encoding AV1 with MediaRecorder via rav1e",
 *  remains NEW/P3/unassigned as of 2026).
 *
 *  The historical bare `video/mp4` and `video/mp4;codecs=avc1` entries
 *  were dropped because Chrome on macOS produced H.264 that its own
 *  VideoToolbox decoder rejects (kVTVideoDecoderBadDataErr / garbled
 *  playback). AV1-in-MP4 uses a separate decoder path that is not
 *  affected, so the MP4 container is still in the list — just with
 *  an AV1 payload only.
 *
 *  iOS Safari 17.4+ plays WebM natively, so a WebM/VP9 output is now
 *  playable everywhere caprr supports (Chromium ≥ 111, Firefox ≥ 110,
 *  Safari ≥ 17 — see CLAUDE.md → Browser support). Saved files round-
 *  trip correctly across the matrix regardless of which codec the
 *  recording browser produced. */
export const MIME_CANDIDATES = [
  // AV1 first — biggest space saving where it's supported on the encode
  // side. Chrome 116+ for `webm;codecs=av01`; Safari 17.4+ for some
  // `mp4;codecs=av01` variants.
  'video/mp4;codecs=av01.0.04M.08,opus',
  'video/webm;codecs=av01,opus',
  'video/webm;codecs=av01',
  'video/mp4;codecs=av01',
  // VP9 fallback — Firefox MediaRecorder produces this. Plays everywhere
  // in the support floor (incl. iOS 17.4+).
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp9',
  'video/webm',
] as const;

export const pickMime = (): string => {
  for (const c of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
};

/** What container extension to use for the saved Blob. MP4 mimes get
 *  '.mp4'; everything else (including the empty string) defaults to
 *  WebM, which is what MediaRecorder produces by default on Chromium
 *  and Firefox. */
export const extForMime = (mime: string): 'mp4' | 'webm' =>
  mime.startsWith('video/mp4') ? 'mp4' : 'webm';
