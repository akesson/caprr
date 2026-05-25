import { defineConfig } from 'vite';

// Dev-only example. The default Vite config is fine; we just want a
// stable port to make the README + smoke instructions reproducible.
export default defineConfig({
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
});
