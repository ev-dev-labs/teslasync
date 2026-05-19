/**
 * a11y test helper — wraps vitest-axe with a project-wide ruleset so
 * every a11y assertion checks the same WCAG-A/AA tags. Use inside any
 * vitest test:
 *
 *   import { expectNoA11yViolations } from '@/test-utils/a11y'
 *   it('is accessible', async () => {
 *     const { container } = render(<Foo />)
 *     await expectNoA11yViolations(container)
 *   })
 *
 * Why a wrapper and not raw axe(): centralising the rule set lets us
 * tune false-positive rules (e.g. colour-contrast in jsdom which has
 * no rendering engine) in ONE place. Rules suppressed here MUST have
 * a comment explaining the suppression so future contributors can
 * audit them.
 */

import { expect } from 'vitest'
import { axe } from 'vitest-axe'

type AxeRuleObject = Record<string, { enabled: boolean }>

const DEFAULT_RULES: AxeRuleObject = {
  // colour-contrast: axe runs against the DOM, but jsdom has no layout
  // engine and no rendering, so every assertion would either silently
  // pass (no styles applied) or false-fail (computed style returns
  // empty strings). Real colour-contrast checking belongs in the
  // Playwright E2E suite which uses a real Chromium.
  'color-contrast': { enabled: false },
  // region: many of our smoke tests render a sub-tree (a card, a
  // single panel) without the surrounding <main> landmark. The
  // landmark structure is verified by full-page E2E tests; for unit
  // tests we only care that the sub-tree itself is internally a11y.
  region: { enabled: false },
}

export async function expectNoA11yViolations(
  container: Element,
  ruleOverrides: AxeRuleObject = {},
): Promise<void> {
  const results = await axe(container, {
    rules: { ...DEFAULT_RULES, ...ruleOverrides },
    // Run WCAG 2.0 A and AA. WCAG AAA is intentionally out of scope —
    // many AAA rules (e.g. minimum text size, sign-language captions)
    // require design decisions that should be made at the UX layer,
    // not enforced by unit tests.
    runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
  })
  // toHaveNoViolations is registered globally in src/test-setup.ts.
  expect(results).toHaveNoViolations()
}
