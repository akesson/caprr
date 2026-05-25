/** Build the floating recorder pill + the review overlay DOM. The
 *  styling is in styles.css; this module just constructs the element
 *  tree with the stable ids the recorder + annotation layers attach to. */

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, v);
  }
  for (const c of children) {
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
};

/** The floating pill. Default state `idle`; the recorder updates the
 *  `data-caprr-state` attribute (via applyState) to drive visual state. */
export const createPill = (): HTMLDivElement => {
  const grip = el('span', {
    id: 'caprr-grip',
    title: 'Drag to move',
  }, ['⠿']);
  const dot = el('span', { id: 'caprr-dot' });
  const status = el('span', { id: 'caprr-status' }, ['Idle']);
  const toggle = el('button', { id: 'caprr-toggle', type: 'button' }, ['Start Recording']);
  return el('div', {
    id: 'caprr-panel',
    'data-caprr-state': 'idle',
  }, [grip, dot, status, toggle]);
};

/** The review overlay — only visible when state === 'reviewing'. It
 *  contains the top toolbar (save/discard), the pane subtoolbar, the
 *  shared stage (video + rrweb player + annotation layer), all stable
 *  ids that the recorder + annotations modules wire into. */
export const createOverlay = (): HTMLDivElement => {
  // Top toolbar
  const status = el('span', { id: 'caprr-overlay-status' }, ['Recording']);
  const save = el('button', { id: 'caprr-save', type: 'button' }, ['Save…']);
  const discard = el('button', { id: 'caprr-discard', type: 'button' }, ['Discard']);
  const toolbar = el('div', { id: 'caprr-overlay-toolbar' }, [status, save, discard]);

  // Pane toggle subtoolbar
  const paneVideo = el('button', {
    id: 'caprr-pane-video',
    type: 'button',
    'aria-pressed': 'true',
  }, ['Pixel video']);
  const paneDom = el('button', {
    id: 'caprr-pane-dom',
    type: 'button',
    'aria-pressed': 'false',
  }, ['DOM replay']);
  const toggleGroup = el('div', { id: 'caprr-toggle-group' }, [paneVideo, paneDom]);
  const addNote = el('button', { id: 'caprr-add-note', type: 'button' }, ['+ Add note']);
  const subtoolbar = el('div', { id: 'caprr-subtoolbar' }, [toggleGroup, addNote]);

  // Stage with the two pane targets + annotation layer
  const video = el('video', {
    id: 'caprr-video',
    controls: '',
    muted: '',
    playsinline: '',
  });
  const playerHost = el('div', { id: 'caprr-player' });
  const annotLayer = el('div', { id: 'caprr-annot-layer' });
  const stage = el('div', { id: 'caprr-stage', 'data-pane': 'video' }, [
    video,
    playerHost,
    annotLayer,
  ]);

  return el('div', {
    id: 'caprr-overlay',
    'data-caprr-state': 'idle',
  }, [toolbar, subtoolbar, stage]);
};
