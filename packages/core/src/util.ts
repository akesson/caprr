/** Small format + DOM lookup helpers. Kept in one file because they're
 *  trivially small and used everywhere. */

export const fmt = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const fmtBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
};

/** Brief uuid-or-nearest. Falls back to timestamp+random when crypto.randomUUID
 *  is unavailable (older WebKit). */
export const newId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return String(Date.now()) + Math.random().toString(16).slice(2);
};

/** Lookup helper. Returns null if absent — caller decides whether that's
 *  an error or a "the panel hasn't mounted yet" no-op. */
export const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;
