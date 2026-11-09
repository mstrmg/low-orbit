import { defineConfig } from 'vite';

// Relative base so the built game runs from any folder (GitHub Pages, a file server, a zip).
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 900 },
});
