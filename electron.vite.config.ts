import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: {
      externalizeDeps: true,
      rollupOptions: { external: ['better-sqlite3'] }
    }
  },
  preload: {
    resolve: { alias: shared },
    build: {
      externalizeDeps: false,
      rollupOptions: { output: { format: 'cjs' } }
    }
  },
  renderer: {
    resolve: { alias: { ...shared, '@renderer': resolve(__dirname, 'src/renderer/src') } },
    plugins: [react(), tailwindcss()]
  }
})
