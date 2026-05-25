/** MediaRecorder mime preferences. WebM/VP9 first — Chrome's MP4 output
 *  on macOS produces H.264 that Chrome's own VideoToolbox decoder rejects
 *  (kVTVideoDecoderBadDataErr / "garbled" playback). MP4 stays as the
 *  fallback for environments where WebM is somehow unsupported.
 *
 *  Trade-off accepted: WebM doesn't play in iOS Safari, but the file
 *  works everywhere else (Chrome, Firefox, macOS Safari, VLC, QuickTime
 *  with the codec installed). */
export const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp9',
  'video/webm',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/mp4',
] as const;

export const pickMime = (): string => {
  for (const c of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
};

/** What container extension to use for the saved Blob. MP4 mimes get
 *  '.mp4'; everything else (including the empty string) defaults to
 *  WebM, which is what MediaRecorder produces by default. */
export const extForMime = (mime: string): 'mp4' | 'webm' =>
  mime.startsWith('video/mp4') ? 'mp4' : 'webm';
