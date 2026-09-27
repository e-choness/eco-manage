import { defineConfig } from 'vitest/config'

export default defineConfig({
  // 24 simulated hours are set up in a beforeAll: it gets the same time as a test.
  test: { include: ['src/**/*.test.ts'], testTimeout: 60_000, hookTimeout: 60_000 },
})
