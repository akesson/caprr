/** Storage abstraction over `MediaRecorder.ondataavailable` chunks.
 *
 *  Two backends, chosen at open time by feature detection:
 *
 *  - **OPFS-backed**: chunks stream straight to a temp file in the
 *    Origin Private File System via `FileSystemWritableFileStream`.
 *    Memory pressure stays bounded regardless of recording length.
 *    Requires `FileSystemFileHandle.createWritable` (Chromium ≥ 86,
 *    Safari ≥ 15.2, Firefox ≥ 111). Below the FF floor declared in
 *    CLAUDE.md (≥ 110) this is not always available — see fallback.
 *
 *  - **In-memory**: the previous `Blob[]` accumulator. Used when OPFS
 *    is unavailable or fails to open.
 *
 *  Both backends present the same interface, so callers don't need
 *  to know which path is active. */

export interface RecordingSink {
  /** Append a chunk from MediaRecorder.ondataavailable. Returns a
   *  promise that resolves once the chunk has been buffered/flushed —
   *  callers may fire-and-forget. */
  writeChunk(blob: Blob): Promise<void>;
  /** Close the underlying writer and return a Blob view of the
   *  full recording. */
  finalize(mimeType: string): Promise<Blob>;
  /** Discard any in-flight bytes. Idempotent. */
  dispose(): Promise<void>;
  /** Identifies which backend was selected — useful for logging
   *  and tests. */
  readonly backend: 'opfs' | 'memory';
}

/** Sink for the rrweb event stream. Mirrors RecordingSink but for
 *  JSON-serializable event objects. Events are batched and flushed
 *  as NDJSON when OPFS is available; otherwise kept in memory.
 *
 *  Note: events are typically 1-10 MB for a 5-minute recording (vs
 *  100-500 MB for the video), so the OPFS savings here are smaller
 *  than for RecordingSink. The benefit is bounded peak memory on
 *  ultra-long DOM-heavy sessions where events do accumulate. */
export interface EventsSink {
  /** Append one rrweb event. Synchronous; flush is debounced
   *  internally so the rrweb emit hot-path doesn't block. */
  push(event: unknown): void;
  /** Flush any buffered events, close the underlying writer, and
   *  return the full ordered event list. */
  finalize(): Promise<unknown[]>;
  /** Read the current size without materializing the array — used
   *  for the "events.length < 2 → discard" check at stop time. */
  readonly count: number;
  /** Discard any in-flight events. Idempotent. */
  dispose(): Promise<void>;
  readonly backend: 'opfs' | 'memory';
}

interface OPFSGlue {
  root: FileSystemDirectoryHandle;
  fileName: string;
  fh: FileSystemFileHandle;
  writable: FileSystemWritableFileStream;
}

const tryOpenOPFS = async (): Promise<OPFSGlue | null> => {
  if (typeof navigator === 'undefined') return null;
  const storage = (navigator as Navigator & { storage?: StorageManager }).storage;
  if (!storage || typeof storage.getDirectory !== 'function') return null;
  try {
    const root = await storage.getDirectory();
    const fileName = 'caprr-recording-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.bin';
    const fh = await root.getFileHandle(fileName, { create: true });
    if (typeof (fh as { createWritable?: unknown }).createWritable !== 'function') {
      // OPFS getFile/getDirectory available but writable streams not
      // (e.g. older Firefox in the 110-111 window).
      return null;
    }
    const writable = await (fh as FileSystemFileHandle).createWritable();
    return { root, fileName, fh, writable };
  } catch {
    return null;
  }
};

export const openRecordingSink = async (): Promise<RecordingSink> => {
  const opfs = await tryOpenOPFS();
  if (opfs) {
    let closed = false;
    return {
      backend: 'opfs',
      async writeChunk(blob) {
        if (closed) return;
        await opfs.writable.write(blob);
      },
      async finalize(mimeType) {
        if (!closed) {
          await opfs.writable.close();
          closed = true;
        }
        const f = await opfs.fh.getFile();
        // Materialize into an in-memory Blob so the consumer is durable
        // across our dispose() removing the OPFS temp file. The main
        // win of OPFS-backed streaming is DURING recording — the
        // accumulated Blob[] never grows in memory, so a 10-minute
        // session does not hold half a gigabyte of pending chunks.
        // At finalize we briefly hold the full file in RAM; Phase 4.3
        // moves the bytes straight from OPFS into the gzip-and-mux
        // worker without materializing through the main thread.
        const buf = await f.arrayBuffer();
        return new Blob([buf], { type: mimeType });
      },
      async dispose() {
        if (!closed) {
          try {
            await opfs.writable.abort();
          } catch {
            // ignore
          }
          closed = true;
        }
        try {
          await opfs.root.removeEntry(opfs.fileName);
        } catch {
          // ignore — file may have been finalized into a Blob already
        }
      },
    };
  }

  // In-memory fallback. Identical interface; chunks land in a Blob[].
  const chunks: Blob[] = [];
  return {
    backend: 'memory',
    async writeChunk(blob) {
      chunks.push(blob);
    },
    async finalize(mimeType) {
      return new Blob(chunks, { type: mimeType });
    },
    async dispose() {
      chunks.length = 0;
    },
  };
};

const EVENT_FLUSH_AT = 256;

interface OPFSEventsGlue {
  root: FileSystemDirectoryHandle;
  fileName: string;
  fh: FileSystemFileHandle;
  writable: FileSystemWritableFileStream;
}

const tryOpenOPFSEvents = async (): Promise<OPFSEventsGlue | null> => {
  if (typeof navigator === 'undefined') return null;
  const storage = (navigator as Navigator & { storage?: StorageManager }).storage;
  if (!storage || typeof storage.getDirectory !== 'function') return null;
  try {
    const root = await storage.getDirectory();
    const fileName = 'caprr-events-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.ndjson';
    const fh = await root.getFileHandle(fileName, { create: true });
    if (typeof (fh as { createWritable?: unknown }).createWritable !== 'function') return null;
    const writable = await (fh as FileSystemFileHandle).createWritable();
    return { root, fileName, fh, writable };
  } catch {
    return null;
  }
};

export const openEventsSink = async (): Promise<EventsSink> => {
  const opfs = await tryOpenOPFSEvents();
  if (opfs) {
    const buffer: unknown[] = [];
    let total = 0;
    let closed = false;
    let writeChain: Promise<void> = Promise.resolve();

    const flush = (): Promise<void> => {
      if (buffer.length === 0 || closed) return Promise.resolve();
      const batch = buffer.splice(0);
      const ndjson = batch.map((e) => JSON.stringify(e)).join('\n') + '\n';
      writeChain = writeChain.then(() => opfs.writable.write(ndjson));
      return writeChain;
    };

    return {
      backend: 'opfs',
      get count(): number {
        return total;
      },
      push(event: unknown): void {
        if (closed) return;
        buffer.push(event);
        total += 1;
        if (buffer.length >= EVENT_FLUSH_AT) {
          void flush();
        }
      },
      async finalize(): Promise<unknown[]> {
        await flush();
        if (!closed) {
          await opfs.writable.close();
          closed = true;
        }
        const file = await opfs.fh.getFile();
        const text = await file.text();
        if (!text) return [];
        const out: unknown[] = [];
        // NDJSON: one JSON value per line. Skip blank lines.
        for (const line of text.split('\n')) {
          if (!line) continue;
          try {
            out.push(JSON.parse(line));
          } catch {
            // skip malformed line; better to lose one event than the whole stream
          }
        }
        return out;
      },
      async dispose(): Promise<void> {
        if (!closed) {
          try {
            await opfs.writable.abort();
          } catch {
            // ignore
          }
          closed = true;
        }
        try {
          await opfs.root.removeEntry(opfs.fileName);
        } catch {
          // ignore
        }
      },
    };
  }

  // In-memory fallback.
  const arr: unknown[] = [];
  return {
    backend: 'memory',
    get count(): number {
      return arr.length;
    },
    push(event: unknown): void {
      arr.push(event);
    },
    async finalize(): Promise<unknown[]> {
      // Return a shallow copy so a follow-up dispose() doesn't wipe the
      // array the caller now owns.
      return arr.slice();
    },
    async dispose(): Promise<void> {
      arr.length = 0;
    },
  };
};
