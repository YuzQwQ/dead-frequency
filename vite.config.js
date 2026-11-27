import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        game: fileURLToPath(new URL('./index.html', import.meta.url)),
        modelEditor: fileURLToPath(new URL('./art/editor.html', import.meta.url)),
      },
      output: {
        manualChunks(id) {
          if (id.includes('/three/build/three.core.js')) return 'three-core';
          if (id.includes('/three/build/three.module.js')) return 'three-renderer';
        },
      },
    },
  },
});
