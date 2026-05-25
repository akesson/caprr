# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`caprr` (capture + rrweb) is a drop-in browser session recorder distributed as two paired packages from one source of truth:

- **`caprr`** (npm) — TypeScript library at `packages/core/`. Built with Vite as ESM + CJS + UMD.
- **`caprr-dioxus`** (crates.io) — Rust crate at `packages/dioxus/` that is a thin shim wrapping the JS bundle. The crate vendors the UMD JS + CSS at publish time so consumers get a self-contained drop-in.

The Rust crate has no runtime logic of its own — `lib.rs` just injects `caprr.umd.js` + `styles.css` and polls `window.caprr` to call `createRecorder()`. All state machine, UI, capture, and persistence logic lives in the JS.

## Commands

```sh
pnpm install                 # workspace deps (uses pnpm@11, requires Node >=22.13)
pnpm typecheck               # tsc --noEmit on packages/core
pnpm build                   # → packages/core/dist (ESM, CJS, UMD, .d.ts, styles.css)
pnpm test                    # vitest run on packages/core
pnpm test:e2e                # playwright (chromium + firefox + webkit) — boots the plain-html example
pnpm vendor:dioxus           # copy core/dist/{caprr.umd.js,styles.css} → dioxus/assets/

# Rust workspace (members: packages/dioxus, examples/dioxus-app)
cargo check --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check

# Run examples
pnpm --filter caprr-example-plain-html dev    # http://localhost:5173
cd examples/dioxus-app && dx serve            # http://localhost:8080

# Single test (vitest)
pnpm --filter caprr test -- path/to/file.test.ts
pnpm --filter caprr test -- -t "test name"
```

CI mirrors this: `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm test` → `pnpm build`, a separate `e2e` job runs `pnpm test:e2e` across all three Playwright browsers (cached by version), then the Rust job runs `pnpm vendor:dioxus` before `cargo check / clippy / fmt`. See `.github/workflows/ci.yml`.

## Critical build dependency: JS → Rust

`packages/dioxus/assets/{caprr.umd.js, styles.css}` are the JS build output, vendored into the Rust crate. They are **committed to git** (see `.gitignore`) because:

1. The Rust crate references them via `asset!()` at compile time.
2. Git-dependency consumers (people pulling `caprr-dioxus` straight from GitHub) won't run `pnpm build`.
3. `cargo publish` packages them into the crates.io tarball.

`packages/dioxus/build.rs` warns (does not error) if the assets are missing. **Before committing any change to `packages/core/`, run `pnpm build && pnpm vendor:dioxus` and commit the regenerated assets in the same change**, or the Rust crate will ship stale JS. The release workflow runs the build+vendor before `cargo publish`, so tag-based releases are safe, but main-branch commits must keep them in sync.

## Architecture: the JS core (`packages/core/src/`)

Module layout, by responsibility:

- `index.ts` — public surface: `createRecorder(opts)`. Returns a no-op handle when `opts.enabled === false` so consumers can mount unconditionally.
- `recorder.ts` — wires everything together. Holds the state machine: `idle → starting → recording → reviewing → idle`. Hosts the global `click` listener (capture phase, since hosts like Dioxus delegate at the root and may swallow bubbling clicks).
- `state.ts` — `RecorderState` shape and lifecycle helpers (`initialState`, `fullCleanup`).
- `ui.ts` + `styles.css` — the floating pill + review overlay DOM. All elements have `id="caprr-…"`; the recorder identifies them by ID prefix.
- `pill-drag.ts` — drag-to-reposition for the floating pill (with click-suppression).
- `annotations.ts` — sticky-note authoring + display, with both pixel anchors and DOM anchors (`rrweb_node_id` resolved via the player's `Mirror`).
- `time.ts` — unified time source over both `<video>` and rrweb-player so annotations render consistently across panes.
- `codec.ts` — MIME negotiation (`pickMime`) and extension mapping for `MediaRecorder`.
- `plugin-network.ts` — rrweb plugin: monkey-patches `fetch` + `XHR` to record request metadata.
- `save.ts` — **sidecar packaging** (see below) plus the save-file picker / anchor fallback.
- `util.ts` — small DOM helpers (`$`, `fmt`, `fmtBytes`).

## The sidecar format (`save.ts`)

caprr's defining trick: a single saved file is **both** a playable video **and** a structured-data archive. The recorder appends a container-appropriate "skip" envelope after the `MediaRecorder` blob, holding `[16-byte marker "rrwebspd-events!"][gzipped JSON]`:

- **MP4** → ISO BMFF `uuid` box (parsers skip unknown boxes per spec).
- **WebM/Matroska** → EBML `Void` element (ID `0xEC`). Without this the EBML parser would choke on trailing non-EBML bytes.

The JSON payload is `SidecarPayloadV3` (`v: 3`) containing `recording.viewport`, `events`, and `annotations`. Schema version is in the payload itself; bump it (and keep backward compat in any reader) when changing the shape. `RRWEB_UUID` is the grep-able marker — re-export it for tooling that extracts the payload.

## State machine invariants

- Only one recorder is mounted in practice, but state is per-instance (not global) so multiple could coexist.
- `start()` is async: it awaits `getDisplayMedia` (which can be cancelled by the user → state returns to `idle`) and `MediaRecorder` `start` event.
- `stop()` is sync but `MediaRecorder.stop` fires `dataavailable` asynchronously; `finalizeVideo` runs once on the `stop` event. If `events.length < 2` or the blob is empty, the recording is discarded and state returns to `idle` instead of entering review.
- `discard()` and `save()` only do anything in the `reviewing` state. `save()` resets to `idle` after the file is written (or after the user cancels the picker).
- `destroy()` removes the document-level click listener, drags, timers, and DOM — call it from framework teardown (the Dioxus shim does this via `use_drop`).
- `#caprr-panel` and `#caprr-overlay` are in `blockSelector` so the recorder's own UI never appears in its recordings.

## Testing

Three layers, in order of preference:

**Vitest + jsdom (`packages/core`)** — pure-logic modules: `codec.ts` (mock `MediaRecorder.isTypeSupported`), `save.ts` (sidecar encode/decode roundtrips, EBML `Void` + MP4 `uuid` envelope framing on raw buffers), `util.ts`, `time.ts`. Fast, deterministic, no browser. Default to this when it suffices.

**Playwright (headless Chromium) with a `getDisplayMedia` stub** — the lifecycle / integration layer. Replace `navigator.mediaDevices.getDisplayMedia` with a function that returns `canvas.captureStream(30)` so no permission picker is ever reached. Inject via `page.addInitScript(...)`. Downstream code — real `MediaRecorder`, real VP9 encode, real Blob assembly, real sidecar embedding — runs untouched, so you can assert on:

- state transitions (`#caprr-status`: `Idle` → `REC …` → `Reviewing`)
- rrweb event count + types (read `window.__caprr` if exposed, or intercept the saved blob)
- WebM magic bytes `1a 45 df a3` on the produced blob
- the two-blob pattern in `save.ts` (raw → sidecar-enriched; delta ≈ gzipped JSON size)
- filename pattern (`caprr-YYYYMMDD-HHMMSS.webm`)
- network + console plugin capture
- the cancel path: a stub that throws `new DOMException('…', 'NotAllowedError')` should return state to `idle`
- `destroy()` cleanup (no listeners, no DOM nodes left)

The Playwright matrix is **Chromium + Firefox + WebKit**; each project asserts on the codec the browser actually negotiated. The plain-html example reads `?test=1` and, in that mode, attaches an `onSave` that parks the saved Blob on `window.__caprrLastSavedBlob` so tests can assert on it without triggering the file picker. Reusable stubs live in `packages/core/e2e/fixtures.ts` (canvas-stream + NotAllowedError); both use `Object.defineProperty` on `navigator.mediaDevices.getDisplayMedia` because direct assignment is shadowed-but-not-effective on WebKit.

Stub:

```js
const canvas = document.createElement('canvas');
canvas.width = 640; canvas.height = 360;
const ctx = canvas.getContext('2d');
let f = 0;
setInterval(() => {
  ctx.fillStyle = `hsl(${(f * 7) % 360},80%,50%)`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillText('frame ' + f++, 20, 60);
}, 33);
navigator.mediaDevices.getDisplayMedia = async () => canvas.captureStream(30);
```

The recorder reads `getDisplayMedia` lazily (on the Start click), so post-load injection works too, but `addInitScript` is the safer default. All three configured Playwright projects (Chromium, Firefox, WebKit) run headless against the canvas-stream stub; `MediaRecorder` quality across them is anecdotally uneven but has not been measured here — see the Browser support section. Driveable IDs: `#caprr-toggle`, `#caprr-status`, `#caprr-save`, `#caprr-discard`, `#caprr-add-note`, `#caprr-overlay-status`, `#caprr-pane-video`, `#caprr-pane-dom`.

**Manual** — anything where "does this *look* right?" is the test. The stubbed pixel source is solid-color squares, not the page, so any assertion on the pixel-video pane under automation is checking the stub, not the product. The following need a human:

- **Annotation position fidelity** — a sticky note must land on the element the user clicked, in **both** the Pixel-video pane and the DOM-replay pane, at the same logical moment. Pixel and DOM anchors are computed independently (`annotations.ts`); cross-pane visual agreement is what's being validated.
- **Time-sync across panes** — `time.ts` reconciles `<video>` time and rrweb-player time. Drift is a perception call.
- **Real `getDisplayMedia` UX** — `preferCurrentTab`, `displaySurface: 'browser'`, current-tab auto-pick. The stub bypasses all of it.
- **Recorder-UI invisibility in the recording** — `#caprr-panel` and `#caprr-overlay` are in `blockSelector` on the rrweb side, but only a real capture confirms they're also absent from the pixel video.
- **Codec/container behavior outside Chromium** — Chrome's MP4 path, WebKit's MediaRecorder limits, Firefox VP9 drift.
- **Pill drag feel** — movement threshold vs. accidental click.

Run a manual pass before every release and on any change to `annotations.ts`, `time.ts`, `ui.ts`, `pill-drag.ts`, or `save.ts`'s container framing.

## Releasing

Tag-driven: `git tag v0.X.Y && git push --follow-tags` triggers `.github/workflows/release.yml`, which publishes npm first (with provenance) and then crates.io. Required secrets: `NPM_TOKEN`, `CRATES_IO_TOKEN`. Version is duplicated in `packages/core/package.json` and `Cargo.toml` (workspace.package.version) — bump both.

## Browser support

Validated end-to-end (record → annotate → save → sidecar roundtrip → VLC playback) on 2026-05-25: **Chromium ≥ 111, Firefox ≥ 110, Safari ≥ 17.** All three negotiated WebM via `pickMime`; the MP4 (`uuid`-box) sidecar path in `save.ts` is unit-tested but not yet seen end-to-end. `preferCurrentTab` / `displaySurface: 'browser'` are Chromium-only picker hints — other browsers ignore them safely.

Target is declared in three places that must stay in sync:

1. `packages/core/package.json` → `browserslist`
2. `packages/core/vite.config.ts` → `build.target`
3. `packages/core/tsconfig.json` → `compilerOptions.target` (currently `ES2022`)

`createRecorder()` feature-detects and returns a no-op handle on unsupported browsers. Re-run the smoke pass and update the date above when changing the target.

## Conventions worth knowing

- `unsafe_code = "forbid"` and `clippy::all = warn` at the workspace level.
- Edition 2024, resolver 3.
- No tests yet under `packages/core/src/` (vitest + jsdom are configured and ready).
- Commit style is conventional-ish (`fix(dioxus): …`, `ci: …`, `chore: …`) — match recent `git log` for new commits.
