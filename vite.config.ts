import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER = `http://localhost:${process.env.PORT ?? 3001}`;

export default defineConfig({
  root: 'src/client',
  publicDir: 'public',
  plugins: [react()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/socket.io': { target: SERVER, ws: true },
      '/api': { target: SERVER },
    },
  },
});
