import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'], physics: ['@dimforge/rapier3d-compat'] },
      },
    },
    // Rapier's self-contained WASM payload is about 2 MB before compression.
    chunkSizeWarningLimit: 2300,
  },
});
