import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// P4-09: every page at 1024 px wide, in both themes, passes axe's WCAG 2 A/AA rules (contrast
// ≥ 4.5:1 among them) and has no horizontal scroll; the rail and pages work from the keyboard.
// Needs the demo seed.

const PAGES = [
  { path: '/', heading: null },
  { path: '/devices', heading: 'Devices' },
  { path: '/history', heading: 'History' },
  { path: '/bills', heading: 'Bills' },
  { path: '/inbox', heading: 'Inbox' },
  { path: '/settings', heading: 'Settings' },
  { path: '/settings?tab=tariff', heading: 'Settings' },
  { path: '/settings?tab=rules', heading: 'Settings' },
  { path: '/settings?tab=model', heading: 'Settings' },
  { path: '/settings?tab=calendar', heading: 'Settings' },
  { path: '/settings?tab=people', heading: 'Settings' },
  { path: '/settings?tab=notifications', heading: 'Settings' },
]

test.use({ viewport: { width: 1024, height: 768 } })

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('manager@ecomanage.io')
  await page.getByLabel('Password').fill('Demo1234!')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
}

// In-app navigation: a reload spends a /api/auth/refresh call, and auth calls are rate limited.
const go = (page: Page, path: string) =>
  page.evaluate((p) => {
    window.history.pushState({}, '', p)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)

const isDark = (page: Page) => page.evaluate(() => document.documentElement.classList.contains('dark'))

async function useTheme(page: Page, dark: boolean) {
  if ((await isDark(page)) !== dark) await page.getByRole('button', { name: /^Switch to (light|dark) theme$/ }).click()
  await expect.poll(() => isDark(page)).toBe(dark)
}

test('every page passes WCAG AA at 1024 px in both themes', async ({ page }) => {
  test.setTimeout(180_000)
  await signIn(page)
  const started = await isDark(page)
  const problems: string[] = []
  try {
    for (const dark of [false, true]) {
      await useTheme(page, dark)
      for (const p of PAGES) {
        const where = `${p.path} (${dark ? 'dark' : 'light'})`
        await go(page, p.path)
        await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
        if (p.heading) await expect(page.getByRole('heading', { name: p.heading, level: 1 })).toBeVisible()
        await page.waitForTimeout(1500) // data loads; the SSE stream never lets the network go idle

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        if (overflow > 0) problems.push(`${where} scrolls sideways by ${overflow}px`)

        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('canvas').analyze()
        for (const v of violations) for (const n of v.nodes.slice(0, 4)) problems.push(`${where} ${v.id}: ${n.target.join(' ')} ${n.failureSummary?.split('\n').slice(1, 2).join('') ?? ''}`)
      }
    }
  } finally {
    await useTheme(page, started)
  }
  expect(problems).toEqual([])
})

test('the app works from the keyboard', async ({ page }) => {
  await signIn(page)

  // Tab reaches the rail; Enter follows a link.
  const devices = page.getByRole('link', { name: 'Devices' })
  for (let i = 0; i < 20 && !(await devices.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
  await expect(devices).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/devices$/)

  // Rows are buttons: focus one and open its panel with the keyboard.
  const row = page.getByRole('table', { name: 'Devices' }).getByRole('row', { name: /Heat pump/ })
  await row.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('complementary', { name: 'Heat pump' })).toBeVisible()

  // The skip link jumps past the rail.
  await go(page, '/settings')
  const skip = page.getByRole('link', { name: 'Skip to content' })
  await skip.focus()
  await expect(skip).toBeInViewport()
  await page.keyboard.press('Enter')
  await expect(page.locator('#content')).toBeFocused()

  // Settings tabs move with the arrow keys, opening each tab.
  await page.getByRole('tab', { name: 'Site', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Tariff' })).toBeFocused()
  await expect(page.getByRole('tab', { name: 'Tariff' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel', { name: 'Tariff' })).toBeVisible()

  // The site's picture has a table alternative for screen readers and the keyboard.
  await go(page, '/')
  await expect(page.getByRole('table', { name: /power flow|site/i })).toBeAttached()
})
