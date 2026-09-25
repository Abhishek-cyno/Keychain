import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The app owns its whole domain now (tap.eqova.in), so it is served from the
 * root. The earlier `/keychain-app/` base existed only to keep its assets out
 * of the way of the WordPress site it used to share eqova.in with.
 */
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: { port: 5173, host: true },
  build: { outDir: 'dist', sourcemap: false },
})
