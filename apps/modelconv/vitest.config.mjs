// Plain object, no imports: in the converter's read-only container the tests run with a copy of
// this file in /tmp (`pnpm test:sandbox`), since Vite writes a bundled config next to it.
export default {
  cacheDir: '/tmp/vitest-modelconv',
  test: { root: '/repo/apps/modelconv', include: ['src/**/*.test.ts'], testTimeout: 180_000, hookTimeout: 60_000, fileParallelism: false },
}
