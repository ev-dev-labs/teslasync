import { test, expect, type Page } from '@playwright/test'

/**
 * Stubs every `/api/v1/*` call with an empty-but-valid JSON 200 response.
 *
 * Why this is required (not just a convenience): `resilientFetch` (see
 * web/src/lib/resilience.ts) treats a non-JSON/HTML 200 *or* a network-level
 * failure as a likely ForwardAuth (Authentik/Authelia) session-expiry signal
 * and hard-navigates the browser to `/outpost.goauthentik.io/start` — by
 * design, so a real deployment recovers from an expired proxy session. This
 * job intentionally runs with no Go API/DB/MQTT stack behind it, so without
 * this stub *every* API call would be misread as "session expired" and the
 * SPA would never settle on the dashboard route at all. Fulfilling with a
 * real `200 application/json` body keeps every call on the ordinary
 * success path instead.
 *
 * `[]` (not `{}`) is used as the universal body: array-shaped consumers get
 * a real (empty) array to `.map()`/`.filter()` per the repo's null-safety
 * contract (`items ?? []`), and object-shaped consumers reading `data?.foo`
 * simply see `undefined` — identical to reading an unknown key off `{}`.
 * Either way, no page in this app is allowed to hide its shell for empty
 * data (see the "always render the panel, never hide the section" rule),
 * so this is a safe universal stub for a boot-only smoke test.
 */
async function stubApi(page: Page): Promise<void> {
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )

  // `<OnboardingGate>` (mounted for every route in App.tsx) reads this
  // endpoint and hard-redirects to /onboarding whenever `is_complete` is
  // falsy — which the generic `[]` stub above would produce (`([]).is_complete`
  // is `undefined`). Registered *after* the catch-all so it wins: Playwright
  // matches routes in the reverse of registration order, i.e. the
  // most-recently-registered handler is tried first.
  await page.route('**/api/v1/onboarding/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tesla_connected: true,
        vehicle_count: 1,
        data_flowing: true,
        is_complete: true,
      }),
    }),
  )
}

/**
 * Boot smoke test — proves the SPA mounts and the dashboard route renders
 * on both the desktop-chrome and mobile-safari projects.
 *
 * Scope is intentionally minimal (see the 0003-playwright-scaffold prompt):
 * this is the scaffold's only test. The full per-page E2E suite (with
 * per-endpoint fixtures) is generated later by the p8-e2e-pages program.
 */
test.describe('app boot', () => {
  test('boots the SPA and renders the dashboard', async ({ page }) => {
    await stubApi(page)
    await page.goto('/')

    // index.html's splash screen removes itself ~800ms after `load`; wait
    // it out so it can never mask a genuine render failure underneath.
    await expect(page.locator('#splash')).toHaveCount(0, { timeout: 10_000 })

    // `usePageTitle('Dashboard')` inside DashboardPage sets this — proves
    // the dashboard route actually mounted (not just the app shell).
    await expect(page).toHaveTitle(/Dashboard — TeslaSync/)

    // <Layout>'s primary nav landmark + brand wordmark render unconditionally
    // (no data dependency) — proves the SPA shell mounted successfully.
    // The wordmark is duplicated in the DOM (separate mobile-drawer-header
    // and desktop-sidebar-header brand blocks, toggled via `lg:hidden` /
    // `hidden lg:flex`), so scope to whichever copy is actually visible at
    // the current viewport — `:visible` is Playwright's CSS extension for
    // this exact "responsive duplicate" situation.
    const nav = page.getByRole('navigation', { name: /primary/i })
    await expect(nav).toBeVisible()
    await expect(nav.locator('span:visible', { hasText: 'TeslaSync' })).toBeVisible()

    // The routed page content always renders its <main> landmark; loading/
    // error/empty states are shown in place rather than hiding the region.
    await expect(page.getByRole('main')).toBeVisible()
  })
})
