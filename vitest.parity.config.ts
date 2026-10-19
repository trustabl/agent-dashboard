import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Artifact parity (tests/parity): real CLI runs, so long timeouts and one file at a time.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    globals: true,
    include: ['tests/parity/**/*.test.ts'],
    environment: 'node',
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
})
