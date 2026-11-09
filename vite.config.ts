import { defineConfig } from 'vite';
import { attachRooms } from './server/rooms';
import { attachDiagnostics, lanLog } from './server/diagnostics';

export default defineConfig({
  plugins: [{ name: 'opencs-lan', configureServer(server) {
    if (!server.httpServer) return;
    const http = server.httpServer as import('node:http').Server;
    const diagnostics = attachDiagnostics(http, 'development');
    attachRooms(http, lanLog);
    server.middlewares.use((req, res, next) => { if (!diagnostics(req, res)) next(); });
  } }],
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
