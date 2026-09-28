import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: 'https://ywe3crmpll.execute-api.us-east-2.amazonaws.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, '/stage'),
          configure: (proxy, _options) => {
            proxy.on('proxyReq', (proxyReq, _req, _res) => {
              if (env.VITE_FP_API_KEY) {
                proxyReq.setHeader('x-api-key', env.VITE_FP_API_KEY);
              }
            });
          }
        }
      }
    }
  }
})
