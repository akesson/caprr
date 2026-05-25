/** Sidecar wrapping: embed our gzipped rrweb-JSON payload at the end of
 *  the MediaRecorder Blob using a container-appropriate envelope so the
 *  same file plays in a video player AND can be parsed back by our
 *  tooling by scanning for the marker UUID.
 *
 *  - MP4: append a spec-compliant `uuid` box (ISO BMFF 14496-12 §8.1.1).
 *    Parsers skip unknown boxes per spec, so it's invisible to playback.
 *  - WebM / Matroska: wrap the same payload in an EBML `Void` element
 *    (ID 0xEC) — Matroska's "skip filler" primitive. Without this the
 *    EBML parser tries to read trailing non-EBML bytes as the next
 *    element and chokes.
 *
 *  Either way, the on-wire layout of the inner payload is
 *
 *      [16-byte marker UUID][gzipped JSON]
 *
 *  The 16-byte marker is the ASCII bytes "rrwebspd-events!" so the
 *  payload is grep-able in a hex viewer. */

import type { Annotation, RrwebEvent, Viewport } from './types';

/** Spells "rrwebspd-events!" in ASCII. Keep this constant — it's the
 *  marker the extractor scans for. */
export const RRWEB_UUID = new Uint8Array([
  0x72, 0x72, 0x77, 0x65, 0x62, 0x73, 0x70, 0x64,
  0x2d, 0x65, 0x76, 0x65, 0x6e, 0x74, 0x73, 0x21,
]);

export const gzipBytes = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

export type Container = 'mp4' | 'webm';

/** Build the container-appropriate envelope bytes. Returns a Uint8Array
 *  that the caller appends to the original media blob. */
export const buildSidecar = (payload: Uint8Array, container: Container): Uint8Array => {
  // Inner bytes: marker + payload. Same shape regardless of container.
  const inner = new Uint8Array(16 + payload.byteLength);
  inner.set(RRWEB_UUID, 0);
  inner.set(payload, 16);

  if (container === 'mp4') {
    // MP4 'uuid' box: [size:4 BE][type:4 ('uuid')][16-byte UUID][payload]
    const boxSize = 8 + inner.byteLength;
    if (boxSize > 0xffffffff) {
      throw new Error('caprr: payload exceeds 4 GB uuid-box limit');
    }
    const out = new Uint8Array(8 + inner.byteLength);
    new DataView(out.buffer).setUint32(0, boxSize, false);
    out[4] = 0x75;
    out[5] = 0x75;
    out[6] = 0x69;
    out[7] = 0x64;
    out.set(inner, 8);
    return out;
  }

  // WebM/Matroska Void: [0xEC][8-byte VINT length][inner]
  // 8-byte VINT = 0x01 marker byte + 7-byte BE length (56-bit max).
  if (inner.byteLength > 0xffffffff) {
    throw new Error('caprr: payload exceeds 4 GB void-element limit');
  }
  const out = new Uint8Array(1 + 8 + inner.byteLength);
  out[0] = 0xec; // Void element ID
  out[1] = 0x01; // VINT marker: 8-byte length follows
  // Bytes 2..4 are upper 24 bits of the 56-bit length (zero for <4 GB);
  // bytes 5..8 hold the low 32 bits.
  new DataView(out.buffer).setUint32(5, inner.byteLength, false);
  out.set(inner, 9);
  return out;
};

/** Timestamp-named filename in local time. Sortable alphabetically. */
export const tsName = (ext: string): string => {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    'caprr-' +
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds()) +
    '.' +
    ext
  );
};

/** Save a Blob to disk. Tries the File System Access API for a real
 *  Save dialog; falls back to a download-attribute anchor. Returns
 *  'cancelled' if the user dismissed the picker, 'saved' otherwise. */
export const saveBlob = async (blob: Blob, name: string): Promise<'saved' | 'cancelled'> => {
  const ext = name.split('.').pop() ?? 'webm';
  // showSaveFilePicker is non-standard; feature-detect.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const picker = (window as any).showSaveFilePicker as
    | ((opts: object) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }>)
    | undefined;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: name,
        types: [{ description: 'Recording', accept: { [blob.type || 'application/octet-stream']: ['.' + ext] } }],
      });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return 'saved';
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return 'cancelled';
      console.warn('[caprr] showSaveFilePicker failed; using anchor fallback', e);
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
  return 'saved';
};

/** Sidecar inner payload — schema v3.
 *  - v1 (predecessor): bare events array.
 *  - v2: { events, annotations } without viewport.
 *  - v3: adds `recording` so a later reader can map pixel anchors back
 *    into rrweb CSS coordinates without depending on whatever viewport
 *    the reviewer is on. */
export interface SidecarPayloadV3 {
  v: 3;
  recording: { viewport: Viewport } | null;
  events: RrwebEvent[];
  annotations: Annotation[];
}
