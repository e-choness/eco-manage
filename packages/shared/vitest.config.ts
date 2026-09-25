import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Schemas are declarations; the helpers must be fully covered (plan P1-02).
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/api/**', 'src/models.ts', 'src/demo.ts'],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
})
