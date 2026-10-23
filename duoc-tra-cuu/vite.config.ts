import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Electron 22 (Chromium 108) là nhánh cuối còn chạy trên Windows 7/8/8.1.
    target: 'chrome108',
  },
})
