import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The Modbus and OCPP tests talk to fake devices on localhost.
  test: { include: ['src/**/*.test.ts'], testTimeout: 20_000, hookTimeout: 20_000 },
})
