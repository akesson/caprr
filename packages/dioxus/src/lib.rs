//! caprr-dioxus — drop a `<Recorder/>` into your Dioxus app to capture
//! rrweb DOM events alongside a pixel video of the tab, with an in-app
//! review overlay for annotation. Saved recordings land as a single
//! `.webm` with an EBML Void sidecar containing the rrweb JSON.
//!
//! Usage:
//! ```ignore
//! use caprr_dioxus::Recorder;
//!
//! #[component]
//! fn App() -> Element {
//!     rsx! {
//!         // Mount the recorder. Gated on `cfg!(debug_assertions)` so it
//!         // compiles out of release builds.
//!         Recorder {}
//!         // … rest of your app
//!     }
//! }
//! ```
//!
//! Implementation comes online in Phase 3 of the extraction; for now this
//! is a placeholder so `cargo check` passes against the workspace.

#![allow(non_snake_case)]

use dioxus::prelude::*;

/// Mount the caprr recorder UI + state machine. Placeholder until P3.
#[component]
pub fn Recorder() -> Element {
    rsx! {}
}
