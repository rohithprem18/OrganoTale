import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5178,
    strictPort: true,
    // Keep the browser's Host header so the API's same-origin check matches, as it does on Vercel.
    proxy: { '/api': { target: 'http://127.0.0.1:3008', changeOrigin: false } },
  },
});
