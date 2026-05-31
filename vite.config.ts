import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// SETUP-2: dev server proxies /v1 → FastAPI so the browser hits one origin
// (no CORS in dev). Prod uses VITE_API_BASE_URL directly. See PLAN SETUP-2.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:8000'

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/v1': { target: apiTarget, changeOrigin: true },
        '/health': { target: apiTarget, changeOrigin: true },
      },
    },
  }
})
