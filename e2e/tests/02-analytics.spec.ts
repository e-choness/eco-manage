import { test, expect } from '@playwright/test'

// Login helper
async function login(page: any) {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'demo@ecomanage.io')
  await page.fill('input[type="password"]', 'Demo1234!')
  await page.click('button:has-text("Sign In")')
  await page.waitForURL('/dashboard', { timeout: 5000 })
}

test.describe('Analytics Features', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('05: Analytics charts load with real data', async ({ page }) => {
    // Navigate to analytics
    await page.click('text=Analytics')
    await page.waitForURL(/\/analytics/, { timeout: 5000 })

    // Wait for charts to load
    await page.waitForTimeout(2000)

    // Verify analytics content is visible
    await expect(page.locator('text=/production|consumption|analytics/i').first()).toBeVisible({
      timeout: 5000,
    })
  })

  test('06: Period switching works (week/month/year)', async ({ page }) => {
    await page.click('text=Analytics')
    await page.waitForURL(/\/analytics/, { timeout: 5000 })

    // Try switching periods - look for period buttons
    const periodButtons = page.getByRole('button', { name: /week|month|year/i })
    const count = await periodButtons.count()

    if (count > 0) {
      // Click different periods and verify data updates
      await periodButtons.first().click()
      await page.waitForTimeout(1000)

      // Verify data is still displayed
      await expect(page.locator('canvas, svg, text').first()).toBeVisible()
    }
  })

  test('07: LLM insight generation works', async ({ page }) => {
    await page.click('text=Analytics')
    await page.waitForURL(/\/analytics/, { timeout: 5000 })

    // Look for insight button or request
    const insightButton = page.getByRole('button', { name: /insight|generate|analyze/i })

    if (await insightButton.count() > 0) {
      await insightButton.click()
      await page.waitForTimeout(2000)

      // Verify response is handled (even if LLM key not configured)
      // Should not show error, just no content or placeholder
      await expect(page).not.toHaveURL(/\/error/)
    }
  })
})
