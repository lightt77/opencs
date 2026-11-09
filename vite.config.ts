import { defineConfig } from 'vite';
import { attachRooms } from './server/rooms';

export default defineConfig({
  plugins: [{ name: 'opencs-lan', configureServer(server) { if (server.httpServer) attachRooms(server.httpServer as import('node:http').Server); } }],
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
