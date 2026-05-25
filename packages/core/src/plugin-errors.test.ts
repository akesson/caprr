import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ErrorEventMeta } from './plugin-errors';
import { buildErrorsPlugin } from './plugin-errors';

/**
 * The plugin attaches to `win.addEventListener('error', ...)` and
 * `win.addEventListener('unhandledrejection', ...)`. Tests synthesize
 * those events and assert the emitted metadata shape.
 *
 * Uses the real jsdom `window` rather than a synthetic one — addEventListener
 * and ErrorEvent / PromiseRejectionEvent constructors live there and produce
 * exactly the shapes the production code unpacks.
 */

describe('buildErrorsPlugin shape', () => {
  it('returns the rrweb-plugin shape with name "rrweb/errors@1"', () => {
    const plug = buildErrorsPlugin();
    expect(plug.name).toBe('rrweb/errors@1');
    expect(typeof plug.observer).toBe('function');
  });
});

describe('error event capture', () => {
  let events: ErrorEventMeta[];
  let cleanup: () => void;

  beforeEach(() => {
    events = [];
    cleanup = buildErrorsPlugin().observer((e) => events.push(e), window);
  });

  afterEach(() => {
    cleanup();
  });

  it('emits a kind:"error" event when window dispatches ErrorEvent', () => {
    const err = new Error('boom');
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'boom',
        filename: 'http://localhost/x.js',
        lineno: 12,
        colno: 34,
        error: err,
      }),
    );
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.kind).toBe('error');
    if (e.kind !== 'error') throw new Error('narrow');
    expect(e.message).toBe('boom');
    expect(e.filename).toBe('http://localhost/x.js');
    expect(e.lineno).toBe(12);
    expect(e.colno).toBe(34);
    // jsdom's Error instances carry stacks
    expect(e.stack).toBeTypeOf('string');
    expect(typeof e.timestamp).toBe('number');
  });

  it('tolerates an ErrorEvent without an `error` payload', () => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'just a string' }));
    expect(events).toHaveLength(1);
    const e = events[0]!;
    if (e.kind !== 'error') throw new Error('narrow');
    expect(e.stack).toBeNull();
  });
});

describe('unhandledrejection capture', () => {
  let events: ErrorEventMeta[];
  let cleanup: () => void;

  beforeEach(() => {
    events = [];
    cleanup = buildErrorsPlugin().observer((e) => events.push(e), window);
  });

  afterEach(() => {
    cleanup();
  });

  // jsdom does not implement PromiseRejectionEvent. The plugin reads
  // `e.reason` off whatever event was dispatched, so we synthesize a
  // generic Event with `reason` attached — identical at the field-access
  // level that production code uses.
  const fakeRejection = (reason: unknown): Event => {
    const e = new Event('unhandledrejection');
    Object.defineProperty(e, 'reason', { value: reason, configurable: true });
    return e;
  };

  it('emits a kind:"unhandledrejection" event with message + stack when reason is an Error', () => {
    const err = new Error('rejected');
    window.dispatchEvent(fakeRejection(err));
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.kind).toBe('unhandledrejection');
    if (e.kind !== 'unhandledrejection') throw new Error('narrow');
    expect(e.message).toBe('rejected');
    expect(e.stack).toBeTypeOf('string');
  });

  it('falls back to String(reason) when reason is not an Error', () => {
    window.dispatchEvent(fakeRejection('plain string reason'));
    expect(events).toHaveLength(1);
    const e = events[0]!;
    if (e.kind !== 'unhandledrejection') throw new Error('narrow');
    expect(e.message).toBe('plain string reason');
    expect(e.stack).toBeNull();
  });
});

describe('cleanup', () => {
  it('removes both listeners on cleanup so post-stop errors are not captured', () => {
    const events: ErrorEventMeta[] = [];
    const cleanup = buildErrorsPlugin().observer((e) => events.push(e), window);
    window.dispatchEvent(new ErrorEvent('error', { message: 'pre' }));
    expect(events).toHaveLength(1);
    cleanup();
    window.dispatchEvent(new ErrorEvent('error', { message: 'post' }));
    expect(events).toHaveLength(1); // unchanged
  });
});
