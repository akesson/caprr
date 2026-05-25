/** WebCodecs-backed video encoder pipeline (opt-in alternative to
 *  MediaRecorder).
 *
 *  Built on Mediabunny: a `MediaStreamVideoTrackSource` pulls frames
 *  directly from the display-capture track and a `MediaStreamVideoTrack
 *  Source` → `Output` pipeline encodes them via the host's
 *  hardware-accelerated WebCodecs `VideoEncoder`. The output bytes are
 *  streamed through an `AppendOnlyStreamTarget` whose readable side is
 *  piped into the same `RecordingSink` interface used by the
 *  MediaRecorder path (Phase 4.1). This means the worker save flow
 *  (Phase 4.3) doesn't change.
 *
 *  Codec: AV1 if the host's VideoEncoder reports support; VP9 fallback.
 *  Both produce playable MP4 across the supported browsers (caniuse:
 *  AV1 playback in Chromium ≥ 70, Firefox ≥ 100, Safari ≥ 17). The
 *  encoding side is where it matters: Chromium 116+ encodes AV1 in
 *  hardware where available; older Chromium and Firefox WebCodecs fall
 *  through to VP9.
 *
 *  Default behavior is unchanged — use `opts.encoder: 'webcodecs'` to
 *  opt in. */

import {
  AppendOnlyStreamTarget,
  canEncodeVideo,
  MediaStreamVideoTrackSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  type VideoCodec,
} from 'mediabunny';

import type { RecordingSink } from './storage';

export type WebCodecsEncoderCodec = Extract<VideoCodec, 'av1' | 'vp9'>;

export interface WebCodecsEncoderHandle {
  /** Stop the encode, flush the muxer, return the produced MP4 Blob via
   *  the supplied sink. */
  finalize(): Promise<Blob>;
  /** Abort and discard. Idempotent. */
  abort(): Promise<void>;
  /** Codec the encoder actually negotiated (for telemetry / tests). */
  readonly codec: WebCodecsEncoderCodec;
}

const MP4_TYPE = 'video/mp4';

/** Picks AV1 if encodable here, otherwise VP9. Falls back to VP9 if
 *  Mediabunny throws on the probe. */
const pickEncodingCodec = async (): Promise<WebCodecsEncoderCodec> => {
  try {
    if (await canEncodeVideo('av1')) return 'av1';
  } catch {
    // ignore
  }
  return 'vp9';
};

/** Start a WebCodecs-backed recording. Streams encoded chunks into the
 *  supplied sink as they're produced. The caller passes the SAME sink
 *  instance that recorder.ts opens via openRecordingSink(); the sink
 *  is finalized by the caller in finalizeVideo. */
export const startWebCodecsRecording = async (
  stream: MediaStream,
  sink: RecordingSink,
): Promise<WebCodecsEncoderHandle> => {
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error('caprr: no video track available for WebCodecs encoder');

  const codec = await pickEncodingCodec();

  const { writable, readable } = new TransformStream<Uint8Array, Uint8Array>();
  const target = new AppendOnlyStreamTarget(writable);
  const output = new Output({
    target,
    format: new Mp4OutputFormat({ fastStart: 'fragmented' }),
  });

  const source = new MediaStreamVideoTrackSource(track, {
    codec,
    bitrate: QUALITY_HIGH,
  });
  output.addVideoTrack(source);

  // Pipe the encoded bytes from Mediabunny's stream into the sink.
  // Each readable chunk is a Uint8Array; wrap as Blob to match the sink
  // contract (which currently expects Blob from MediaRecorder).
  const pumpDone = (async (): Promise<void> => {
    const reader = readable.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          await sink.writeChunk(new Blob([value as BlobPart]));
        }
      }
    } finally {
      reader.releaseLock();
    }
  })();

  // Surface encoder errors so the recorder can transition back to idle
  // rather than hanging.
  let aborted = false;
  let sourceError: Error | null = null;
  source.errorPromise.catch((e: unknown) => {
    sourceError = e instanceof Error ? e : new Error(String(e));
  });

  await output.start();

  return {
    codec,
    async finalize(): Promise<Blob> {
      if (sourceError) throw sourceError;
      try {
        await output.finalize();
      } catch (e) {
        // mediabunny may throw if the track ended unexpectedly; let
        // the caller decide whether to treat that as a hard failure.
        console.warn('[caprr] WebCodecs output.finalize failed', e);
      }
      await pumpDone;
      return sink.finalize(MP4_TYPE);
    },
    async abort(): Promise<void> {
      if (aborted) return;
      aborted = true;
      try {
        await output.cancel();
      } catch {
        // ignore
      }
    },
  };
};

/** Feature-detect whether the WebCodecs path is reachable here. Cheap
 *  enough to call from the option-parsing fast path. */
export const isWebCodecsRecordingSupported = (): boolean => {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof MediaStreamTrackProcessor !== 'undefined'
  );
};
