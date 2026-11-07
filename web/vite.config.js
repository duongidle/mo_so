import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    port: 5173,
    host: true,
    fs: { allow: ['..'] }, // cho phép nhập brand/tokens.css ở thư mục gốc
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 900 },
  test: { globals: true, environment: 'jsdom', include: ['src/**/*.test.{js,jsx}'], css: false, restoreMocks: true },
});
