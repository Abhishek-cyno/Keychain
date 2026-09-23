import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * In production the app is mounted inside the existing WordPress docroot on
 * eqova.in, so its own JS/CSS must be requested from a folder WordPress will
 * not try to interpret as a permalink. `base` changes only where those asset
 * files are fetched from — the routes themselves (/d/:id, /admin) stay at the
 * site root, which is what gets printed on the keychains.
 *
 * Dev keeps base "/" so http://localhost:5173/d/1 works unchanged.
 */
export const PROD_BASE = '/keychain-app/'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? PROD_BASE : '/',
  plugins: [react()],
  server: { port: 5173, host: true },
  build: { outDir: 'dist', sourcemap: false },
}))
