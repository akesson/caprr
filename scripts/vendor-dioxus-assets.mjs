#!/usr/bin/env node
/**
 * Copy the built JS + CSS from `packages/core/dist` into
 * `packages/dioxus/assets`. The Rust crate references those via
 * `include_bytes!` / `asset!()` and ships them at publish time.
 *
 * Run via `pnpm vendor:dioxus` after `pnpm build`.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'packages/core/dist');
const dst = join(root, 'packages/dioxus/assets');

const files = ['caprr.umd.js', 'styles.css'];

if (!existsSync(src)) {
  console.error(`error: source missing: ${src}`);
  console.error(`run \`pnpm build\` first`);
  process.exit(1);
}
mkdirSync(dst, { recursive: true });

let copied = 0;
for (const f of files) {
  const from = join(src, f);
  const to = join(dst, f);
  if (!existsSync(from)) {
    console.error(`error: ${from} not found — did the core build succeed?`);
    process.exit(1);
  }
  copyFileSync(from, to);
  copied++;
  console.log(`copied ${f}`);
}
console.log(`vendored ${copied} files into ${dst}`);
