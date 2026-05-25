//! caprr-dioxus — drop a `<Recorder/>` into your Dioxus app to capture
//! rrweb DOM events alongside a pixel video of the tab, with an in-app
//! review overlay for annotation. Saved recordings land as a single
//! `.webm` with an EBML Void sidecar containing the rrweb JSON.
//!
//! ## Usage
//!
//! ```ignore
//! use caprr_dioxus::Recorder;
//!
//! #[component]
//! fn App() -> Element {
//!     rsx! {
//!         // Mount the recorder. cfg!(debug_assertions) keeps it out of
//!         // release builds; pass any boolean expression that fits your
//!         // gating policy.
//!         Recorder { enabled: cfg!(debug_assertions) }
//!         // … the rest of your app
//!     }
//! }
//! ```
//!
//! The Rust side is a thin shim: it injects the bundled JavaScript and
//! CSS via `asset!()`-managed URLs, then runs a small boot script that
//! waits for the global `window.caprr` to appear and instantiates the
//! recorder. The actual state machine, UI, and persistence all live in
//! the JS bundle so they can be reused outside of Dioxus.

#![allow(non_snake_case)]

use dioxus::prelude::*;

/// Bundled JavaScript — the UMD build of `caprr` (sets `window.caprr`).
/// Produced by `pnpm build` in `packages/core/` and copied here by
/// `scripts/vendor-dioxus-assets.mjs` before `cargo publish`.
const CAPRR_JS: Asset = asset!("/assets/caprr.umd.js");

/// Bundled stylesheet for the pill + review overlay + sticky notes.
const CAPRR_CSS: Asset = asset!("/assets/styles.css");

/// Small boot script: poll for `window.caprr` (the UMD bundle may load
/// after this inline script), then call `caprr.createRecorder(opts)`
/// once and stash the handle on `window.__caprrInstance` so we can call
/// `destroy()` on it when the component unmounts.
///
/// The options are passed as a JSON literal substituted into the script
/// text at render time.
fn boot_script(opts_json: &str) -> String {
    format!(
        r#"(function () {{
  if (window.__caprrInstance) return;
  const opts = {opts_json};
  let waited = 0;
  const boot = setInterval(function () {{
    waited += 100;
    if (window.caprr && typeof window.caprr.createRecorder === 'function') {{
      window.__caprrInstance = window.caprr.createRecorder(opts);
      clearInterval(boot);
    }} else if (waited > 15000) {{
      clearInterval(boot);
      console.warn('[caprr-dioxus] window.caprr never appeared after 15s');
    }}
  }}, 100);
}})();"#
    )
}

/// Mount the caprr recorder UI + state machine.
///
/// When `enabled` is `false`, the component renders nothing — gate it on
/// `cfg!(debug_assertions)` to keep recordings out of production builds.
#[component]
pub fn Recorder(
    /// Master switch. Default `true`. Set to `false` to render nothing.
    #[props(default = true)]
    enabled: bool,
    /// Auto-stop the recording after this many ms. Default 5 min.
    #[props(default = 5 * 60 * 1000)]
    max_recording_ms: u32,
    /// Capture `fetch` + `XHR` request metadata. Default `true`.
    #[props(default = true)]
    capture_network: bool,
    /// Capture `console.*` calls via the rrweb console plugin. Default `true`.
    #[props(default = true)]
    capture_console: bool,
    /// Capture window `error` + `unhandledrejection` events. Default `true`.
    #[props(default = true)]
    capture_errors: bool,
    /// Pass through to rrweb's `recordCanvas` option. Default `false`
    /// — canvas capture is expensive and rarely needed; opt in when
    /// the recorded app genuinely uses canvas for pixel state.
    #[props(default = false)]
    record_canvas: bool,
) -> Element {
    if !enabled {
        return rsx! {};
    }

    // Build the options JSON literal substituted into the boot script.
    let opts_json = format!(
        r#"{{"maxRecordingMs":{max_recording_ms},"captureNetwork":{capture_network},"captureConsole":{capture_console},"captureErrors":{capture_errors},"recordCanvas":{record_canvas}}}"#
    );
    let boot = boot_script(&opts_json);

    // Tear down the recorder when this component unmounts so reloads /
    // route changes don't leak its document-level event listeners.
    use_drop(|| {
        let _ = document::eval(
            "if (window.__caprrInstance) { try { window.__caprrInstance.destroy(); } catch (e) {} \
             window.__caprrInstance = null; }",
        );
    });

    rsx! {
        document::Stylesheet { href: CAPRR_CSS }
        document::Script { src: CAPRR_JS }
        document::Script { "{boot}" }
    }
}
