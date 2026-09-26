import { expect, test } from '@playwright/test'

// P1-12 smoke test (login and addresses updated in P4-02): log in, Home shows live values from
// the simulator, and they change within 10 seconds (plan §6, simulator E2E 1). Needs the demo
// seed and the simulator running.

test('the manager sees live values from the simulated site', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('manager@ecomanage.io')
  await page.getByLabel('Password').fill('Demo1234!')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page).toHaveURL(/:\d+\/$/)
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await expect(page.getByTestId('site-name')).toHaveText('Maple Grove School')
  await expect(page.getByTestId('live-status')).toHaveText('Live')

  // Values come from the simulator through the broker, ingest, Redis and the SSE stream. A newer
  // meter reading must arrive within 10 s (compare timestamps: one-decimal kW can repeat).
  await expect(page.getByTestId('flow-grid')).toHaveText(/\d+\.\d kW (import|export)/)
  const meter = page.getByRole('row', { name: /Grid meter/ }).locator('[data-ts]')
  await expect(meter).not.toHaveAttribute('data-ts', '')
  const first = Date.parse((await meter.getAttribute('data-ts')) ?? '')
  await expect
    .poll(async () => Date.parse((await meter.getAttribute('data-ts')) ?? ''), { timeout: 10_000, intervals: [500] })
    .toBeGreaterThan(first)

  // Every simulated device is listed with a live status.
  for (const name of ['Inverter A', 'Battery', 'Grid meter', 'EV charger 1', 'Heat pump']) {
    await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('live')
  }
})

test('a signed-out visitor is sent to sign in, and old addresses still work', async ({ page }) => {
  await page.goto('/dashboard/alerts')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Sign in to your site' })).toBeVisible()
})
