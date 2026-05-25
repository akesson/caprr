import { describe, expect, it } from 'vitest';
import { RRWEB_UUID, buildSidecar, gzipBytes, tsName, type SidecarPayloadV3 } from './save';

const gunzipBytes = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const stream = new Response(bytes as BlobPart).body!.pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/** Scan a buffer for the 16-byte RRWEB_UUID marker. Returns the index where
 *  the *payload* starts (i.e. one byte past the marker's last byte), or -1
 *  if the marker isn't found. Mirrors what an out-of-band extractor would
 *  do at read time. */
const findMarker = (haystack: Uint8Array): number => {
  outer: for (let i = 0; i <= haystack.length - RRWEB_UUID.length; i++) {
    for (let j = 0; j < RRWEB_UUID.length; j++) {
      if (haystack[i + j] !== RRWEB_UUID[j]) continue outer;
    }
    return i + RRWEB_UUID.length;
  }
  return -1;
};

const samplePayload = (): SidecarPayloadV3 => ({
  v: 3,
  recording: { viewport: { width: 1280, height: 800, dpr: 2 } },
  events: [
    { type: 0, timestamp: 1_000, data: { tag: 'meta' } },
    { type: 2, timestamp: 1_050, data: { node: 17, attrs: { class: 'x' } } },
  ],
  annotations: [
    {
      id: 'a-1',
      t_start: 100,
      t_end: 500,
      pixel: { x: 0.4, y: 0.6 },
      dom: { selector: '#cta', rrweb_node_id: 17, tag: 'button' },
      text: 'Look here',
    },
    {
      id: 'a-2',
      t_start: 800,
      t_end: null,
      pixel: { x: 0.7, y: 0.3 },
      dom: null,
      text: 'Open-ended note',
    },
  ],
});

describe('RRWEB_UUID', () => {
  it('spells "rrwebspd-events!" in ASCII', () => {
    expect(new TextDecoder('ascii').decode(RRWEB_UUID)).toBe('rrwebspd-events!');
  });

  it('is exactly 16 bytes (matches MP4 uuid-box payload requirement)', () => {
    expect(RRWEB_UUID.byteLength).toBe(16);
  });
});

describe('gzipBytes round-trip', () => {
  it('compresses then decompresses to the original bytes', async () => {
    const original = new TextEncoder().encode('hello caprr ' + JSON.stringify(samplePayload()));
    const compressed = await gzipBytes(original);
    expect(compressed.byteLength).toBeGreaterThan(0);
    expect(compressed.byteLength).not.toBe(original.byteLength); // gzip framing always changes length
    const decompressed = await gunzipBytes(compressed);
    // Compare as plain arrays — Uint8Array deep-equal across realms (Node vs jsdom)
    // can disagree on prototype identity even when byte contents match.
    expect([...decompressed]).toEqual([...original]);
  });

  it('emits a gzip header (1f 8b) at byte 0', async () => {
    const compressed = await gzipBytes(new TextEncoder().encode('a'));
    expect(compressed[0]).toBe(0x1f);
    expect(compressed[1]).toBe(0x8b);
  });
});

describe('buildSidecar(webm)', () => {
  it('produces a Void element envelope (0xEC, 8-byte VINT length)', async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const sidecar = buildSidecar(payload, 'webm');
    expect(sidecar[0]).toBe(0xec); // Void element ID
    expect(sidecar[1]).toBe(0x01); // VINT marker for 8-byte length
    // Length field = bytes 2..8 BE, total 56-bit. Low 32 bits at offset 5.
    const lowLen = new DataView(sidecar.buffer, sidecar.byteOffset + 5, 4).getUint32(0, false);
    expect(lowLen).toBe(payload.byteLength + RRWEB_UUID.byteLength);
    // First 16 bytes after the header are the marker UUID.
    const innerStart = 1 + 8;
    expect(sidecar.slice(innerStart, innerStart + 16)).toEqual(RRWEB_UUID);
    // Payload follows.
    expect(sidecar.slice(innerStart + 16)).toEqual(payload);
  });

  it('round-trips a real gzipped sidecar payload via marker scan + gunzip', async () => {
    const payload = samplePayload();
    const compressed = await gzipBytes(new TextEncoder().encode(JSON.stringify(payload)));
    const sidecar = buildSidecar(compressed, 'webm');
    const idx = findMarker(sidecar);
    expect(idx).toBeGreaterThan(-1);
    const inner = sidecar.slice(idx); // gzipped payload follows the marker
    const decompressed = await gunzipBytes(inner);
    const parsed = JSON.parse(new TextDecoder().decode(decompressed)) as SidecarPayloadV3;
    expect(parsed).toEqual(payload);
  });

  it('preserves WebM magic bytes when appended to a fake video blob', async () => {
    const ebmlMagic = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]); // EBML header
    const fakeVideo = new Uint8Array([...ebmlMagic, 0x00, 0xde, 0xad, 0xbe, 0xef]);
    const compressed = await gzipBytes(new TextEncoder().encode('{}'));
    const sidecar = buildSidecar(compressed, 'webm');
    const concatenated = new Uint8Array(fakeVideo.byteLength + sidecar.byteLength);
    concatenated.set(fakeVideo, 0);
    concatenated.set(sidecar, fakeVideo.byteLength);
    expect(concatenated.slice(0, 4)).toEqual(ebmlMagic);
    // And the marker is still findable in the suffix.
    expect(findMarker(concatenated)).toBeGreaterThan(fakeVideo.byteLength);
  });
});

describe('buildSidecar(mp4)', () => {
  it('produces an ISO BMFF uuid box: [size:4 BE][type "uuid"][16-byte UUID][payload]', () => {
    const payload = new Uint8Array([0xaa, 0xbb, 0xcc]);
    const sidecar = buildSidecar(payload, 'mp4');
    const size = new DataView(sidecar.buffer, sidecar.byteOffset, 4).getUint32(0, false);
    expect(size).toBe(8 + RRWEB_UUID.byteLength + payload.byteLength);
    expect(new TextDecoder('ascii').decode(sidecar.slice(4, 8))).toBe('uuid');
    expect(sidecar.slice(8, 8 + 16)).toEqual(RRWEB_UUID);
    expect(sidecar.slice(8 + 16)).toEqual(payload);
  });

  it('round-trips a real gzipped sidecar payload', async () => {
    const payload = samplePayload();
    const compressed = await gzipBytes(new TextEncoder().encode(JSON.stringify(payload)));
    const sidecar = buildSidecar(compressed, 'mp4');
    const idx = findMarker(sidecar);
    expect(idx).toBeGreaterThan(-1);
    const decompressed = await gunzipBytes(sidecar.slice(idx));
    const parsed = JSON.parse(new TextDecoder().decode(decompressed)) as SidecarPayloadV3;
    expect(parsed).toEqual(payload);
  });
});

describe('tsName', () => {
  it('emits caprr-YYYYMMDD-HHMMSS.<ext>', () => {
    expect(tsName('webm')).toMatch(/^caprr-\d{8}-\d{6}\.webm$/);
    expect(tsName('mp4')).toMatch(/^caprr-\d{8}-\d{6}\.mp4$/);
  });
});
