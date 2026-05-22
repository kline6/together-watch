import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (_proxyReq, req) => {
            console.log('[vite-proxy] →', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            console.log('[vite-proxy] ←', proxyRes.statusCode, req.url);
          });
          proxy.on('error', (err, req) => {
            console.log('[vite-proxy] ERROR:', err.message, req.url);
          });
        },
      },
      '/socket.io': {
        target: 'http://127.0.0.1:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
