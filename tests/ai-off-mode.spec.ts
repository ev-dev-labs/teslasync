// Phase-50 / 0001 — F0 AI-Off Contract.
//
// Playwright-style off-mode walk. The repository does not yet ship a
// configured Playwright runner; this file is a skeleton that the
// 9999 final-gate will execute (gated behind `RUN_PLAYWRIGHT=1`)
// once Playwright is wired up. Until then it is intentionally inert
// and the Vitest invariant suite
// (web/src/ai/__tests__/offMode.invariant.test.tsx) carries the same
// guarantee at the unit-test level.
//
// The structure intentionally mirrors the format Playwright will use
// so that wiring it up is a one-liner change to the runner config.

import { test, expect } from '@playwright/test';

// Skip when the env flag is not set so the suite is harmless to
// every developer/CI pipeline that does not yet have Playwright
// installed. The 9999 final-gate explicitly sets RUN_PLAYWRIGHT=1.
const SHOULD_RUN = process.env.RUN_PLAYWRIGHT === '1';

test.describe('AI-Off Contract — DOM walk', () => {
  test.skip(!SHOULD_RUN, 'Skipped unless RUN_PLAYWRIGHT=1 is set in the environment');

  test('no element on the SPA carries data-ai-feature when ai_mode=off', async ({ page }) => {
    // Default seed makes ai_mode='off' (migration 000201 default).
    // This walk asserts the contract end-to-end across every route
    // a logged-in user would normally visit. The route list is
    // intentionally hard-coded here (rather than imported from the
    // SPA's router) so a regression that adds an unguarded AI route
    // cannot also silently pass this check by tampering with the
    // imported list.
    const routes = ['/', '/dashboard', '/vehicles', '/charging', '/drives', '/analytics', '/settings'];

    for (const route of routes) {
      await page.goto(route);
      // Give SSE / lazy chunks a frame to settle.
      await page.waitForLoadState('networkidle');
      const aiSurface = page.locator('[data-ai-feature]');
      const count = await aiSurface.count();
      expect(count, `route ${route} should contain no [data-ai-feature] elements in off mode`).toBe(0);
    }
  });

  test('every /api/v1/ai/* endpoint returns 404 in off mode', async ({ request }) => {
    // The seed registry only contains chatbot-llm in slice F0;
    // later slices add their own routes here as they ship.
    const aiRoutes: ReadonlyArray<{ method: 'POST' | 'GET'; path: string }> = [
      { method: 'POST', path: '/api/v1/ai/chatbot' },
    ];

    for (const r of aiRoutes) {
      const resp = await request.fetch(r.path, { method: r.method });
      expect(resp.status(), `${r.method} ${r.path} must 404 when ai_mode=off (ADR-015 §I6)`).toBe(404);
    }
  });
});
