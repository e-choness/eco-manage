import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://api:3000',
        changeOrigin: true,
      },
    },
    allowedHosts: [
      'localhost',
      // compose service name, used by containers such as the E2E runner
      'web',
      '.pythagora.ai'
    ],
    watch: {
      ignored: ['**/node_modules/**', '**/dist/**', '**/public/**', '**/log/**']
    }
  },
})
