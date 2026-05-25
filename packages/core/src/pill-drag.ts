/** Drag the floating pill anywhere on screen, persisting its position
 *  to localStorage so it survives reloads. Mirrors the spike's behavior.
 *  Returns a cleanup that removes the document-level handlers. */

import { $ } from './util';

const POS_KEY = 'caprrPillPos';

interface ClampedPos {
  x: number;
  y: number;
}

const clampInto = (x: number, y: number, w: number, h: number): ClampedPos => ({
  x: Math.max(0, Math.min(window.innerWidth - w, x)),
  y: Math.max(0, Math.min(window.innerHeight - h, y)),
});

const applyPos = (x: number, y: number): void => {
  const p = $('caprr-panel');
  if (!p) return;
  p.style.left = x + 'px';
  p.style.top = y + 'px';
  p.style.right = 'auto';
  p.style.bottom = 'auto';
};

export const restorePillPos = (): void => {
  const p = $('caprr-panel');
  if (!p) return;
  let saved: { x: number; y: number } | null = null;
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch {
    // noop
  }
  if (!saved) return;
  const r = p.getBoundingClientRect();
  const c = clampInto(saved.x, saved.y, r.width, r.height);
  applyPos(c.x, c.y);
};

const persistPos = (): void => {
  const p = $('caprr-panel');
  if (!p) return;
  const r = p.getBoundingClientRect();
  try {
    localStorage.setItem(POS_KEY, JSON.stringify({ x: r.left, y: r.top }));
  } catch {
    // noop
  }
};

export interface PillDragHandle {
  destroy(): void;
  /** True while a drag is in progress; the click handler reads this to
   *  suppress the synthetic click that fires after a real drag. */
  swallowNextClick: { value: boolean };
}

export const installPillDrag = (): PillDragHandle => {
  interface DragState {
    startX: number;
    startY: number;
    rect: DOMRect;
    moved: boolean;
  }
  let drag: DragState | null = null;
  const swallowNextClick = { value: false };

  const onDown = (e: PointerEvent): void => {
    const p = $('caprr-panel');
    if (!p || !(e.target instanceof Node) || !p.contains(e.target)) return;
    if ((e.target as HTMLElement).closest('button')) return; // buttons handle their own clicks
    const r = p.getBoundingClientRect();
    drag = { startX: e.clientX, startY: e.clientY, rect: r, moved: false };
    p.classList.add('dragging');
    try {
      p.setPointerCapture(e.pointerId);
    } catch {
      // noop
    }
    e.preventDefault();
  };

  const onMove = (e: PointerEvent): void => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    const c = clampInto(drag.rect.left + dx, drag.rect.top + dy, drag.rect.width, drag.rect.height);
    applyPos(c.x, c.y);
  };

  const endDrag = (): void => {
    if (!drag) return;
    const p = $('caprr-panel');
    if (p) p.classList.remove('dragging');
    if (drag.moved) {
      persistPos();
      swallowNextClick.value = true;
      setTimeout(() => {
        swallowNextClick.value = false;
      }, 50);
    }
    drag = null;
  };

  // Re-clamp on resize so a previously-saved corner doesn't push the
  // pill off-screen when the viewport shrinks.
  const onResize = (): void => {
    const p = $('caprr-panel');
    if (!p) return;
    if (!p.style.left) return; // never moved; default CSS position applies
    const r = p.getBoundingClientRect();
    const c = clampInto(r.left, r.top, r.width, r.height);
    applyPos(c.x, c.y);
  };

  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', endDrag, true);
  document.addEventListener('pointercancel', endDrag, true);
  window.addEventListener('resize', onResize);

  return {
    swallowNextClick,
    destroy(): void {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', endDrag, true);
      document.removeEventListener('pointercancel', endDrag, true);
      window.removeEventListener('resize', onResize);
    },
  };
};
