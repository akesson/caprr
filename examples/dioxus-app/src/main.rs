//! Minimal Dioxus app that mounts the caprr Recorder. Run with `dx serve`.

#![allow(non_snake_case)]

use caprr_dioxus::Recorder;
use dioxus::prelude::*;

fn main() {
    launch(App);
}

#[component]
fn App() -> Element {
    let mut count = use_signal(|| 0_i32);

    rsx! {
        // The recorder mounts its floating pill + review overlay into
        // <body> directly. Renders nothing when `enabled` is false.
        Recorder { enabled: true }

        div {
            style: "font: 14px/1.5 system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px;",
            h1 { "caprr · Dioxus example" }
            p {
                "Recorder pill is in the bottom-right. Click Start, share this tab, "
                "click some of the buttons below, then Stop to enter review."
            }

            div {
                style: "display: flex; gap: 12px; margin: 20px 0;",
                button {
                    "data-cy": "btn-inc",
                    style: "padding: 8px 14px; border-radius: 6px; cursor: pointer;",
                    onclick: move |_| count += 1,
                    "Increment ({count})"
                }
                button {
                    "data-cy": "btn-dec",
                    style: "padding: 8px 14px; border-radius: 6px; cursor: pointer;",
                    onclick: move |_| count -= 1,
                    "Decrement"
                }
                button {
                    "data-cy": "btn-reset",
                    style: "padding: 8px 14px; border-radius: 6px; cursor: pointer;",
                    onclick: move |_| count.set(0),
                    "Reset"
                }
            }

            p {
                "Counter value: "
                strong { "{count}" }
            }
        }
    }
}
