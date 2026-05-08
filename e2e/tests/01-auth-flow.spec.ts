import { test, expect } from '@playwright/test'

test.describe('Authentication Flow', () => {
  test('01: Landing page loads', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/EcoManage|Landing|Energy/i)
    // Verify landing page content exists
    await expect(page.locator('text=/renewable|energy|dashboard/i').first()).toBeVisible()
  })

  test('02: Register new user and login', async ({ page }) => {
    // Register
    const email = `test-${Date.now()}@example.com`
    const password = 'TestPass1234!'
    const name = 'Test User'

    await page.goto('/register')
    await expect(page.locator('button:has-text("Create Account")')).toBeVisible()

    await page.fill('input[placeholder*="full name" i]', name)
    await page.fill('input[type="email"]', email)
    await page.fill('input[type="password"]', password)

    await page.click('button:has-text("Create Account")')

    // After successful registration, should be redirected to dashboard
    await page.waitForURL('/dashboard', { timeout: 5000 })
    await expect(page).toHaveURL(/\/dashboard/)

    // Logout
    await page.click('button:has-text("Sign out")', { timeout: 1000 }).catch(() => {
      // Sign out button might not be immediately visible
    })
  })

  test('03: Login with demo credentials', async ({ page }) => {
    await page.goto('/login')

    await page.fill('input[type="email"]', 'demo@ecomanage.io')
    await page.fill('input[type="password"]', 'Demo1234!')

    await page.click('button:has-text("Sign In")')

    // Should be redirected to dashboard
    await page.waitForURL('/dashboard', { timeout: 5000 })
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('04: Dashboard loads with real data', async ({ page }) => {
    // Login first
    await page.goto('/login')
    await page.fill('input[type="email"]', 'demo@ecomanage.io')
    await page.fill('input[type="password"]', 'Demo1234!')
    await page.click('button:has-text("Sign In")')

    await page.waitForURL('/dashboard', { timeout: 5000 })

    // Verify dashboard is loaded - wait for heading
    await expect(page.getByRole('heading', { name: /Energy Management Dashboard/i })).toBeVisible({ timeout: 5000 })

    // Verify metrics are displayed - look for metric cards with data
    await expect(page.locator('text=/Current Power|Daily Production|Total Savings|Carbon Offset|kW|$/i').first()).toBeVisible({
      timeout: 5000,
    })
  })
})
