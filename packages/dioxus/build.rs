//! Verify the vendored JS + CSS exist before the crate compiles. The two
//! files in `assets/` are produced by `pnpm build` in `packages/core/` and
//! copied here by `scripts/vendor-dioxus-assets.mjs`. They're gitignored,
//! so a fresh clone won't have them — emit a clear error in that case.

use std::path::Path;

fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let assets = Path::new(&manifest_dir).join("assets");
    let js = assets.join("caprr.umd.js");
    let css = assets.join("styles.css");

    if !js.exists() || !css.exists() {
        // Crates.io publishes include `assets/`, so this only fires for
        // local builds straight after a clean checkout.
        println!(
            "cargo:warning=caprr-dioxus: vendored assets missing at {}",
            assets.display()
        );
        println!(
            "cargo:warning=run `pnpm install && pnpm build && pnpm vendor:dioxus` at the repo root"
        );
    }

    println!("cargo:rerun-if-changed=assets/caprr.umd.js");
    println!("cargo:rerun-if-changed=assets/styles.css");
}
