import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // Vite does NOT copy .env values into process.env inside this file, so they must be read with loadEnv.
  // `php artisan serve` silently moves to 8001, 8002… when 8000 is taken: set VITE_API_PROXY in
  // frontend/.env or .env.local (or the shell). Vite restarts by itself when those files change.
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
  const target = env.VITE_API_PROXY || 'http://127.0.0.1:8000'

  return {
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) {
              return 'vendor-react'
            }
            if (id.includes('src/pages/master-data/')) {
              return 'chunk-master-data'
            }
            if (id.includes('src/pages/applications/')) {
              return 'chunk-applications'
            }
            if (id.includes('src/pages/work-orders/')) {
              return 'chunk-work-orders'
            }
            if (id.includes('src/pages/drawings/') || id.includes('src/pages/mto/') || id.includes('src/pages/proposals/') || id.includes('src/pages/surveys/')) {
              return 'chunk-engineering-proposals'
            }
            if (id.includes('src/pages/admin/') || id.includes('src/pages/backup/')) {
              return 'chunk-admin-system'
            }
          },
        },
      },
    },
    server: {
      // Same-origin in dev: no CORS configuration needed on the backend.
      proxy: { '/api': { target, changeOrigin: true } },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setup.js',
    },
  }
})
