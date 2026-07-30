import { defineConfig } from 'vitest/config'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
  /*
   * No dev proxy: lib/api.ts already calls the API on an absolute origin
   * (VITE_API_URL, default http://localhost:8000). The old proxy entries for
   * /situations, /alerts and /deliveries shadowed the app's own routes, so
   * loading /situations directly returned the API's JSON 404 instead of the
   * app.
   */
})
