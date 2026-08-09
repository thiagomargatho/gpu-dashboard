import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // O backend serve estes arquivos; sem sourcemap o dist fica pequeno.
    sourcemap: false,
  },
  server: {
    // Só para `npm run dev`. Em produção o próprio backend serve o dist.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8099', changeOrigin: true },
    },
  },
});
