import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_', 'SUPERADMIN_'],
  server: {
    // Proxy API calls in dev so the frontend can call `/api/*`
    // without worrying about CORS or absolute URLs.
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // Leave the path as-is (no rewrite) since server already uses /api
      },
    },
  },
})
