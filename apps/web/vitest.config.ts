import { defineConfig } from 'vitest/config'

// Vitest config kept separate from vite.config.ts to avoid the React-compiler babel plugin
// in the test transform (not needed for logic tests).
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
