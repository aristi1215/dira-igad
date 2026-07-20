import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  server: {
    proxy: {
      '/map': 'http://localhost:8000',
      '/situations': 'http://localhost:8000',
      '/alerts': 'http://localhost:8000',
      '/deliveries': 'http://localhost:8000',
      '/events': 'http://localhost:8000',
    },
  },
})
