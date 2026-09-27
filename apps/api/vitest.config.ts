import { defineConfig } from 'vitest/config';

// API tests (moved from Jest with the 2026 dependency update: Jest's per-file VM realm broke the
// MongoDB driver's handshake, and ts-jest held TypeScript back). Integration suites use their own
// database each against the compose MongoDB and Redis.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.spec.ts'],
    setupFiles: ['src/__tests__/setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/__tests__/**'],
      thresholds: { branches: 55, functions: 55, lines: 55, statements: 55 },
    },
  },
});
