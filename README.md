# caprr — capture + rrweb

Drop-in DOM session recorder for the browser. Captures rrweb DOM events alongside a pixel video of the tab, lets the reviewer annotate moments and regions, and saves the whole bundle as a single `.webm` file with an embedded JSON sidecar (EBML `Void` element). The same file plays in any video player and yields the structured data back to any tool that knows how to extract it.

This repository is a monorepo with two publishable packages:

| Package | Lives in | Distributed as |
|---|---|---|
| `caprr` | `packages/core/` | npm — `import { createRecorder } from 'caprr'` |
| `caprr-dioxus` | `packages/dioxus/` | crates.io — `<Recorder/>` Dioxus component |

The Rust crate vendors the built JS at publish time, so consumers of either package get a self-contained drop-in with rrweb + plugins bundled inside.

## Status

v0.1.0 — extraction in progress from the [LeaveDates frontend spike](https://gitlab.com/leavedates.com/frontend) where the recorder was prototyped. Plan: [plan.md](./PLAN.md). Not yet published.

## Repo layout

```
caprr/
├── packages/
│   ├── core/          # the JS library (TypeScript + Vite)
│   └── dioxus/        # the Rust integration (asset!-loaded JS shim)
├── examples/
│   ├── plain-html/    # <script type=module> demo
│   └── dioxus-app/    # minimal Dioxus app
└── scripts/
    └── vendor-dioxus-assets.mjs   # copies core/dist → dioxus/assets
```

## Development

```sh
pnpm install
pnpm build           # builds packages/core → dist/
pnpm vendor:dioxus   # copies built JS into packages/dioxus/assets
cargo check          # checks the Rust workspace
```

## License

MIT — see [LICENSE](./LICENSE).
