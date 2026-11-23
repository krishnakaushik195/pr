import { defineConfig } from 'vite';

// three.js is only loaded via a dynamic import when a visitor opens the 3D tour,
// so it is automatically split from the main bundle.
export default defineConfig({
  build: { chunkSizeWarningLimit: 900 },
});
