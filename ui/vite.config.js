import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/search': {
        target: 'http://localhost:8000'
      },
      '/rerank': {
        target: 'http://localhost:8000'
      }
    }
  }
})