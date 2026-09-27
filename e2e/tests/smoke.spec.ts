import { expect, test } from '@playwright/test'

// P1-12 smoke test (login and addresses from P4-02, Home from P4-03): log in, Home shows live
// values from the simulator, and they keep changing (plan §6, simulator E2E 1). Needs the demo
// seed and the simulator running.

test('the manager sees live values from the simulated site', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('manager@ecomanage.io')
  await page.getByLabel('Password').fill('Demo1234!')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page).toHaveURL(/:\d+\/$/)
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await expect(page.getByTestId('site-name')).toHaveText('Maple Grove School')
  await expect(page.getByTestId('live-status')).toHaveText('live')

  // Home (P4-03): every simulated source and load is labelled on the site, with its power.
  for (const key of ['pv', 'battery', 'grid', 'ev', 'heatpump']) {
    await expect(page.getByTestId(`scene-label-${key}`)).toContainText(/\d+\.\d\s*kW/)
  }
  await expect(page.getByRole('region', { name: 'Demand' })).toContainText('cap 120 kW')
  await expect(page.getByRole('region', { name: 'Needs you' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Electricity price today' })).toBeVisible()

  // Values come from the simulator through the broker, ingest, Redis and the SSE stream: newer
  // events must keep arriving (the stream stamps the time of the last one it applied).
  const status = page.getByTestId('live-status')
  await expect(status).not.toHaveAttribute('data-last-event', '')
  const first = Number(await status.getAttribute('data-last-event'))
  await expect.poll(async () => Number(await status.getAttribute('data-last-event')), { timeout: 10_000, intervals: [500] }).toBeGreaterThan(first)

  // Devices (P4-04): every simulated device listed as online with its power now.
  await page.getByRole('link', { name: 'Devices' }).click()
  const devices = page.getByRole('table', { name: 'Devices' })
  for (const name of ['Inverter A', 'Battery', 'Grid meter', 'EV charger 1', 'Heat pump']) {
    await expect(devices.getByRole('row', { name: new RegExp(name) })).toContainText('Online')
  }
  await expect(page.getByRole('complementary', { name: 'Inverter A' })).toBeVisible()

  // History (P4-05): today's hourly bars from the 15-min intervals, and totals.
  await page.getByRole('link', { name: 'History' }).click()
  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: 'Today' }).click()
  await expect(page.getByTestId('range-text')).toContainText('1 day · hourly')
  expect(await page.getByTestId('history-bar').count()).toBeGreaterThanOrEqual(23) // 23–25 on DST days
  await expect(page.getByRole('list', { name: 'Totals' }).getByRole('listitem')).toHaveCount(5)

  // Bills (P4-06): every billing period listed, the newest open one in detail.
  await page.getByRole('link', { name: 'Bills' }).click()
  await expect(page.getByRole('table', { name: 'Bills' }).getByRole('row').nth(1)).toContainText('In progress')
  await expect(page.getByTestId('bill-total')).toHaveText(/^\$[\d,]+$/)
})

test('a signed-out visitor is sent to sign in, and old addresses still work', async ({ page }) => {
  await page.goto('/dashboard/alerts')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Sign in to your site' })).toBeVisible()
})
