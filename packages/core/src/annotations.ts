/** Annotation data + creation + DOM-target resolution + rendering +
 *  drag. Kept in one file because the pieces are tightly coupled — the
 *  resolver mutates the same Annotation that addNote pushed and that
 *  render() positions. */

import type { RecorderState } from './state';
import type { TimeSource } from './time';
import type { Annotation, AnnotationDom, RrwebReplayer } from './types';
import { $, newId } from './util';

/** Compute a CSS selector for an element. Priority order:
 *    1. `#id`
 *    2. `[data-cy="…"]` (project convention in many test suites)
 *    3. tag + nth-child chain capped at 4 levels — walks upward until
 *       it finds an ancestor with id/data-cy, then stops there.
 *
 *  The selector is for HUMAN READABILITY. The rrweb_node_id stored
 *  alongside is the authoritative anchor. */
export const computeSelector = (elem: Element | null): string | null => {
  if (!elem || !elem.tagName) return null;
  if (elem.id) {
    return '#' + (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(elem.id) : elem.id);
  }
  const cy = elem.getAttribute('data-cy');
  if (cy) return `[data-cy="${cy}"]`;
  const parts: string[] = [];
  let cur: Element | null = elem;
  for (let i = 0; i < 4 && cur && cur.tagName; i++) {
    if (cur.id) {
      parts.unshift('#' + (CSS && CSS.escape ? CSS.escape(cur.id) : cur.id));
      break;
    }
    const c = cur.getAttribute('data-cy');
    if (c) {
      parts.unshift(`[data-cy="${c}"]`);
      break;
    }
    let part = cur.tagName.toLowerCase();
    const p: Element | null = cur.parentElement;
    if (p) {
      const idx = Array.from(p.children).indexOf(cur);
      part += `:nth-child(${idx + 1})`;
    }
    parts.unshift(part);
    cur = p;
  }
  return parts.join(' > ');
};

/** Probe the rrweb-player's rebuilt iframe at its current playhead and
 *  return the DOM target under the given normalized stage coordinates. */
const resolveDomTargetNow = (s: RecorderState, normX: number, normY: number): AnnotationDom | null => {
  if (!s.player) return null;
  let replayer: RrwebReplayer | undefined;
  try {
    replayer = s.player.getReplayer();
  } catch {
    return null;
  }
  if (!replayer) return null;
  const iframe = replayer.iframe;
  const doc = iframe && (iframe.contentDocument || iframe.contentWindow?.document);
  if (!doc || !doc.body) return null;
  const vp = s.recording?.viewport;
  if (!vp) return null;
  const cssX = normX * vp.width;
  const cssY = normY * vp.height;
  let elem: Element | null;
  try {
    elem = doc.elementFromPoint(cssX, cssY);
  } catch {
    return null;
  }
  if (!elem) return null;
  let nodeId: number | null = null;
  try {
    const mirror = typeof replayer.getMirror === 'function' ? replayer.getMirror() : null;
    if (mirror && typeof mirror.getId === 'function') {
      const id = mirror.getId(elem);
      if (id != null && id >= 0) nodeId = id;
    }
  } catch {
    // fall through
  }
  return {
    selector: computeSelector(elem),
    rrweb_node_id: nodeId,
    tag: elem.tagName ? elem.tagName.toLowerCase() : null,
  };
};

/** Seek the player to t (idempotent) and resolve with retries until
 *  the iframe is laid out OR 200 ms elapsed. */
const resolveDomTargetAt = (s: RecorderState, tMs: number, normX: number, normY: number): Promise<AnnotationDom | null> =>
  new Promise((resolve) => {
    if (!s.player) {
      resolve(null);
      return;
    }
    try {
      s.player.goto(tMs, false);
    } catch {
      // fall through
    }
    const start = performance.now();
    const tryOne = (): void => {
      const r = resolveDomTargetNow(s, normX, normY);
      if (r) {
        resolve(r);
        return;
      }
      if (performance.now() - start > 200) {
        resolve(null);
        return;
      }
      requestAnimationFrame(tryOne);
    };
    requestAnimationFrame(tryOne);
  });

/** Compute the (left, top) inside the annot layer for an annotation,
 *  branching on the active pane.
 *
 *  - Video pane: use the pixel anchor (normalized × layer dimensions).
 *  - DOM pane: if rrweb_node_id resolves and is still in the rebuilt
 *    DOM, position at its bbox; otherwise fall back to pixel. */
const positionForRender = (
  s: RecorderState,
  a: Annotation,
  layerRect: DOMRect,
): { left: number; top: number } => {
  if (s.activePane === 'dom' && a.dom && a.dom.rrweb_node_id != null && s.player) {
    try {
      const replayer = s.player.getReplayer();
      const mirror = replayer && typeof replayer.getMirror === 'function' ? replayer.getMirror() : null;
      const node = mirror && typeof mirror.getNode === 'function' ? mirror.getNode(a.dom.rrweb_node_id) : null;
      if (replayer && node && typeof (node as Element).getBoundingClientRect === 'function') {
        const er = (node as Element).getBoundingClientRect();
        if (er && (er.width || er.height)) {
          const iframe = replayer.iframe;
          if (iframe) {
            const fr = iframe.getBoundingClientRect();
            const screenX = fr.left + er.left;
            const screenY = fr.top + er.top;
            return { left: screenX - layerRect.left, top: screenY - layerRect.top };
          }
        }
      }
    } catch {
      // fall through to pixel anchor
    }
  }
  return {
    left: a.pixel.x * layerRect.width,
    top: a.pixel.y * layerRect.height,
  };
};

/** Build the DOM for a single sticky note. */
const buildNoteNode = (s: RecorderState, time: TimeSource, a: Annotation): HTMLDivElement => {
  const node = document.createElement('div');
  node.className = 'caprr-note';
  node.dataset.annId = a.id;

  const text = document.createElement('div');
  text.className = 'caprr-note-text';
  text.contentEditable = 'true';
  text.spellcheck = false;
  text.addEventListener('input', () => {
    a.text = text.innerText;
  });
  // Don't let editing the text trigger the note drag handler.
  text.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
  });

  const actions = document.createElement('div');
  actions.className = 'caprr-note-actions';

  const trim = document.createElement('button');
  trim.type = 'button';
  trim.className = 'caprr-note-trim';
  trim.textContent = 'End here';
  trim.title = 'End this note at the current time';
  trim.addEventListener('click', (e) => {
    e.stopPropagation();
    a.t_end = time.current;
    renderAnnotations(s, time);
  });

  const kill = document.createElement('button');
  kill.type = 'button';
  kill.className = 'caprr-note-kill';
  kill.textContent = '×';
  kill.title = 'Remove this note entirely';
  kill.addEventListener('click', (e) => {
    e.stopPropagation();
    const idx = s.annotations.findIndex((x) => x.id === a.id);
    if (idx >= 0) s.annotations.splice(idx, 1);
    renderAnnotations(s, time);
  });

  actions.appendChild(trim);
  actions.appendChild(kill);
  node.appendChild(text);
  node.appendChild(actions);
  return node;
};

/** Repaint the annotation layer based on the current time + pane. */
export const renderAnnotations = (s: RecorderState, time: TimeSource): void => {
  const layer = $('caprr-annot-layer');
  if (!layer) return;
  const t = time.current;
  const visible = s.annotations.filter(
    (a) => a.t_start <= t && t < (a.t_end == null ? Infinity : a.t_end),
  );
  const visibleIds = new Set(visible.map((a) => a.id));
  for (const node of Array.from(layer.children) as HTMLElement[]) {
    if (!visibleIds.has(node.dataset['annId'] ?? '')) node.remove();
  }
  const rect = layer.getBoundingClientRect();
  for (const a of visible) {
    let node = layer.querySelector<HTMLDivElement>(`[data-ann-id="${a.id}"]`);
    if (!node) {
      node = buildNoteNode(s, time, a);
      layer.appendChild(node);
    }
    const textNode = node.querySelector<HTMLDivElement>('.caprr-note-text');
    if (textNode && document.activeElement !== textNode && textNode.innerText !== a.text) {
      textNode.innerText = a.text;
    }
    const pos = positionForRender(s, a, rect);
    node.style.left = pos.left + 'px';
    node.style.top = pos.top + 'px';
  }
};

/** Create a new annotation at the playback's current time, drop it
 *  near the center of the stage, and asynchronously resolve a DOM
 *  anchor against the rrweb-player's rebuilt iframe. */
export const addNote = (s: RecorderState, time: TimeSource): void => {
  if (s.state !== 'reviewing') return;
  time.pause();
  const t = time.current;
  const a: Annotation = {
    id: newId(),
    t_start: t,
    t_end: null,
    pixel: { x: 0.45, y: 0.45 },
    dom: null,
    text: '',
  };
  s.annotations.push(a);
  renderAnnotations(s, time);
  // Focus the text node so the user can start typing immediately.
  const layer = $('caprr-annot-layer');
  const textNode = layer?.querySelector<HTMLDivElement>(`[data-ann-id="${a.id}"] .caprr-note-text`);
  if (textNode) {
    textNode.focus();
    try {
      const sel = window.getSelection();
      const r = document.createRange();
      r.selectNodeContents(textNode);
      r.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(r);
    } catch {
      // noop
    }
  }
  // Resolve a DOM anchor at the spawn position.
  void resolveDomTargetAt(s, t, a.pixel.x, a.pixel.y).then((dom) => {
    if (dom) {
      a.dom = dom;
      renderAnnotations(s, time);
    }
  });
};

/** Install document-level note-drag handlers in capture phase. Returns
 *  a cleanup that removes them on destroy. */
export const installNoteDrag = (s: RecorderState, time: TimeSource): (() => void) => {
  interface DragState {
    ann: Annotation;
    layerRect: DOMRect;
    offsetX: number;
    offsetY: number;
    moved: boolean;
    noteEl: HTMLElement;
  }
  let drag: DragState | null = null;

  const onDown = (e: PointerEvent): void => {
    const layer = $('caprr-annot-layer');
    if (!layer || !(e.target instanceof Node) || !layer.contains(e.target)) return;
    const target = e.target as HTMLElement;
    const noteEl = target.closest<HTMLElement>('.caprr-note');
    if (!noteEl) return;
    if (target.closest('button')) return;
    if (target.closest('.caprr-note-text')) return;
    const annId = noteEl.dataset['annId'];
    const ann = s.annotations.find((a) => a.id === annId);
    if (!ann) return;
    const lr = layer.getBoundingClientRect();
    const nr = noteEl.getBoundingClientRect();
    drag = {
      ann,
      layerRect: lr,
      offsetX: e.clientX - nr.left,
      offsetY: e.clientY - nr.top,
      moved: false,
      noteEl,
    };
    noteEl.classList.add('dragging');
    try {
      noteEl.setPointerCapture(e.pointerId);
    } catch {
      // noop
    }
    e.preventDefault();
  };

  const onMove = (e: PointerEvent): void => {
    if (!drag) return;
    const { ann, layerRect, offsetX, offsetY, noteEl } = drag;
    const px = e.clientX - layerRect.left - offsetX;
    const py = e.clientY - layerRect.top - offsetY;
    if (!drag.moved) {
      const dx = e.clientX - (layerRect.left + offsetX + ann.pixel.x * layerRect.width);
      const dy = e.clientY - (layerRect.top + offsetY + ann.pixel.y * layerRect.height);
      if (Math.hypot(dx, dy) < 3) return;
    }
    drag.moved = true;
    const nx = Math.max(0, Math.min(1, px / layerRect.width));
    const ny = Math.max(0, Math.min(1, py / layerRect.height));
    ann.pixel.x = nx;
    ann.pixel.y = ny;
    noteEl.style.left = nx * layerRect.width + 'px';
    noteEl.style.top = ny * layerRect.height + 'px';
  };

  const onUp = (): void => {
    if (!drag) return;
    drag.noteEl.classList.remove('dragging');
    const { ann, moved } = drag;
    drag = null;
    if (moved) {
      void resolveDomTargetAt(s, ann.t_start, ann.pixel.x, ann.pixel.y).then((dom) => {
        ann.dom = dom;
        if (s.activePane === 'dom') renderAnnotations(s, time);
      });
    }
  };

  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', onUp, true);
  return () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
  };
};
