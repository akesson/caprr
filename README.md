# caprr — capture + rrweb

Drop-in DOM session recorder for the browser. Captures rrweb DOM events alongside a pixel video of the tab, lets the reviewer annotate moments and regions, and saves the whole bundle as a single `.webm` file with an embedded JSON sidecar (EBML `Void` element). The same file plays in any video player and yields the structured data back to any tool that knows how to extract it.

This repository is a monorepo with two publishable packages:

| Package | Source | Distributed as |
|---|---|---|
| `caprr` | `packages/core/` | npm — `import { createRecorder } from 'caprr'` |
| `caprr-dioxus` | `packages/dioxus/` | crates.io — `<Recorder/>` Dioxus component |

The Rust crate vendors the built JS at publish time, so consumers of either package get a self-contained drop-in with rrweb + plugins bundled inside.

## Status

v0.1.0 — extracted from a [LeaveDates frontend spike](https://gitlab.com/leavedates.com/frontend). Builds and passes empirical smoke tests; not yet published to registries.

## Usage

### npm / TypeScript

```ts
import { createRecorder } from 'caprr';
import 'caprr/styles.css';

const rec = createRecorder({
  enabled: import.meta.env.DEV,
  maxRecordingMs: 5 * 60_000,
  captureNetwork: true,
  captureConsole: true,
});
// rec.start() / rec.stop() / rec.discard() / rec.save() / rec.destroy()
```

### Dioxus

```rust
use caprr_dioxus::Recorder;

#[component]
fn App() -> Element {
    rsx! {
        Recorder { enabled: cfg!(debug_assertions) }
        // … the rest of your app
    }
}
```

Both packages mount a floating "record" pill in the bottom-right of the page. Recording → Stop → review overlay with annotation. Saved files are `.webm` plus a `Void`-wrapped JSON sidecar containing rrweb events, viewport metadata, and annotations (each with both a pixel anchor and a DOM-element anchor when one resolves).

## Browser support

Validated end-to-end on Chromium ≥ 111, Firefox ≥ 110, Safari ≥ 17 — all produce WebM output. `createRecorder()` returns a no-op handle on unsupported browsers, so you can mount unconditionally.

## Repo layout

```
caprr/
├── packages/
│   ├── core/          # the JS library (TypeScript + Vite)
│   └── dioxus/        # the Rust integration crate
├── examples/
│   ├── plain-html/    # Vite + vanilla TS demo
│   └── dioxus-app/    # minimal Dioxus app
├── scripts/
│   └── vendor-dioxus-assets.mjs   # copies core/dist → dioxus/assets
└── rrwebui.pen        # Pencil design source — review-screen UX mockup
```

## Development

```sh
pnpm install
pnpm typecheck
pnpm build                       # → packages/core/dist
pnpm vendor:dioxus               # copy into packages/dioxus/assets
cargo check --workspace
cargo clippy --workspace --all-targets -- -D warnings

# Run an example
pnpm --filter caprr-example-plain-html dev    # → http://localhost:5173
cd examples/dioxus-app && dx serve            # → http://localhost:8080
```

## Publishing

1. Bump versions in `packages/core/package.json` and `packages/dioxus/Cargo.toml`.
2. Update `README.md` if needed.
3. Commit + tag: `git commit -am 'chore: release v0.1.0' && git tag v0.1.0 && git push --follow-tags`.
4. The `Release` workflow in `.github/workflows/release.yml` publishes to npm first (with provenance) and then to crates.io.

Required GitHub secrets:
- `NPM_TOKEN` — npm publish token with publish rights to `caprr`.
- `CRATES_IO_TOKEN` — crates.io API token with publish rights to `caprr-dioxus`.

## License

MIT — see [LICENSE](./LICENSE).
