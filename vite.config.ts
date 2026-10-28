import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'document-runtime-config',
      transformIndexHtml: html =>
        html.replace(
          '/runtimeConfig.js',
          process.env.DOCUMENT_RUNTIME_CONFIG || '/runtimeConfig.js'
        ),
    },
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    proxy: {
      '/api':
        process.env.DOCUMENT_API_URL ||
        process.env.DOCUMENT_MOCK_URL ||
        'http://127.0.0.1:3045',
    },
  },
});
