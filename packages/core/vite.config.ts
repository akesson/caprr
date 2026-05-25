import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'node:path';

// Library build:
//   - ESM   → dist/index.js     (consumed by bundlers + modern <script type=module>)
//   - CJS   → dist/index.cjs    (legacy bundlers / node tooling that still asks for require())
//   - UMD   → dist/caprr.umd.js (CDN drop-in: <script src=…> → window.caprr)
//   - .d.ts → dist/index.d.ts   (TypeScript consumers)
//   - css   → dist/styles.css   (copied/emitted from src/styles.css)
//
// rrweb + its plugins are *bundled in* (per the architecture decision) so that
// a consumer has a single import with version pinning guaranteed.
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'caprr',
      fileName: (format) => {
        if (format === 'es') return 'index.js';
        if (format === 'cjs') return 'index.cjs';
        if (format === 'umd') return 'caprr.umd.js';
        return `index.${format}.js`;
      },
      formats: ['es', 'cjs', 'umd'],
    },
    sourcemap: true,
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        assetFileNames: (info) => {
          if (info.name?.endsWith('.css')) return 'styles.css';
          return 'assets/[name][extname]';
        },
      },
    },
  },
  plugins: [
    dts({
      entryRoot: 'src',
      outDir: 'dist',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      insertTypesEntry: true,
    }),
  ],
});
