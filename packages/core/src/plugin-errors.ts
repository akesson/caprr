/** rrweb plugin: capture window 'error' and 'unhandledrejection' events
 *  as type-6 (Plugin) entries in the rrweb stream. Metadata only — never
 *  capture exception objects themselves (they may carry references to
 *  large/structured app state and serialize unpredictably).
 *
 *  Patches are scoped to the recording: the observer's returned cleanup
 *  removes the listeners when rrweb.record() stops. */

export type ErrorEventMeta =
  | {
      kind: 'error';
      message: string;
      filename: string | null;
      lineno: number | null;
      colno: number | null;
      stack: string | null;
      timestamp: number;
    }
  | {
      kind: 'unhandledrejection';
      message: string;
      stack: string | null;
      timestamp: number;
    };

type EmitCb = (data: ErrorEventMeta) => void;

interface RrwebPlugin {
  name: string;
  observer: (cb: EmitCb, win: Window) => () => void;
}

/** Best-effort stack extraction from `unhandledrejection.reason`, which
 *  may be an Error, a plain value, or anything else. */
const extractStack = (reason: unknown): string | null => {
  if (reason && typeof reason === 'object' && 'stack' in reason && typeof reason.stack === 'string') {
    return reason.stack;
  }
  return null;
};

/** Best-effort message extraction with the same defensiveness. */
const extractMessage = (reason: unknown): string => {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string') return reason;
  try {
    return String(reason);
  } catch {
    return '<unprintable>';
  }
};

export const buildErrorsPlugin = (): RrwebPlugin => ({
  name: 'rrweb/errors@1',
  observer: (cb, win) => {
    const onError = (e: ErrorEvent): void => {
      cb({
        kind: 'error',
        message: e.message || '',
        filename: e.filename || null,
        lineno: typeof e.lineno === 'number' ? e.lineno : null,
        colno: typeof e.colno === 'number' ? e.colno : null,
        stack: e.error && typeof e.error === 'object' && 'stack' in e.error && typeof (e.error as { stack?: string }).stack === 'string'
          ? (e.error as { stack: string }).stack
          : null,
        timestamp: Date.now(),
      });
    };

    const onRejection = (e: PromiseRejectionEvent): void => {
      cb({
        kind: 'unhandledrejection',
        message: extractMessage(e.reason),
        stack: extractStack(e.reason),
        timestamp: Date.now(),
      });
    };

    win.addEventListener('error', onError);
    win.addEventListener('unhandledrejection', onRejection);

    return () => {
      win.removeEventListener('error', onError);
      win.removeEventListener('unhandledrejection', onRejection);
    };
  },
});
