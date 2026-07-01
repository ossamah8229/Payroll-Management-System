import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Proxies /api during dev so the browser sees the frontend and backend as the same origin —
// avoids CORS/cookie edge cases in local development. Production serves the frontend as a
// separate Render Static Site talking to the backend's real URL (docs/architecture/deployment.md),
// configured via VITE_API_URL instead — see src/lib/api-client.ts.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // `@payroll/shared` is a CommonJS workspace package (see shared/tsconfig.json for why).
  // Vite/Rollup's default commonjs interop doesn't reliably reach npm-workspace-linked packages
  // the same way it does ordinary node_modules dependencies, so it's named explicitly here for
  // both the dev-time pre-bundler (esbuild) and the production build (Rollup).
  optimizeDeps: {
    include: ['@payroll/shared'],
  },
  build: {
    commonjsOptions: {
      include: [/shared/, /node_modules/],
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
