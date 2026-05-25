/** Web Worker that takes the in-memory SidecarPayloadV3 and returns the
 *  framed sidecar bytes (gzip + container envelope). Moves the blocking
 *  JSON.stringify off the main thread; the gzip is already async via
 *  CompressionStream but goes through the worker too for one round-trip.
 *
 *  Vite bundles this as an inline Blob URL via `?worker&inline` so the
 *  caprr UMD bundle remains a single file — important for the
 *  caprr-dioxus crate, which `asset!()`-ships exactly two files. */

import { buildSidecar, gzipBytes, type SidecarPayloadV3 } from './save';

interface SaveRequest {
  payload: SidecarPayloadV3;
  container: 'webm' | 'mp4';
}

interface SaveResponseOk {
  ok: true;
  sidecar: Uint8Array;
}

interface SaveResponseErr {
  ok: false;
  error: string;
}

type SaveResponse = SaveResponseOk | SaveResponseErr;

self.onmessage = async (msg: MessageEvent<SaveRequest>): Promise<void> => {
  try {
    const { payload, container } = msg.data;
    const json = new TextEncoder().encode(JSON.stringify(payload));
    const compressed = await gzipBytes(json);
    const sidecar = buildSidecar(compressed, container);
    // Transfer the buffer back to avoid an extra copy at the main-thread
    // boundary.
    const response: SaveResponseOk = { ok: true, sidecar };
    (self as unknown as { postMessage: (msg: SaveResponse, transfer?: Transferable[]) => void }).postMessage(
      response,
      [sidecar.buffer],
    );
  } catch (e) {
    const response: SaveResponseErr = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
    self.postMessage(response);
  }
};

// Tell TypeScript this is a module worker context.
export {};
