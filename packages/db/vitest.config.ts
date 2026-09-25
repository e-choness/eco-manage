import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Tests share one MongoDB database per file; run files one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
  },
})
