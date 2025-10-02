import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@teekit/tunnel'],
  },
  resolve: {
    alias: {
      // Polyfill Node.js built-ins for browser
      events: 'events',
      buffer: 'buffer',
      util: 'util',
    },
  },
})
