/**
 * ImpersonationPolicyPanel contract.
 *
 * The panel is a static, presentational "how impersonation works" reading
 * band — no data source — so the coverage focuses on structure, i18n wiring,
 * accessibility, and the stable-id refactor:
 *
 *   1. Renders the panel heading + intro copy (and the panel test hook).
 *   2. Renders all five guarantees (titles + bodies) as exactly five list items.
 *   3. Decorative icons are aria-hidden and the list is programmatically labelled.
 *   4. Exposes stable, translation-independent test ids for each guarantee.
 *   5. Every visible string flows through t('key', 'English default').
 *   6. A language switch relabels each card IN PLACE (stable key) instead of
 *      remounting it — the regression guard for the old `key={item.title}` bug.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { vi } from 'vitest'
import type { ReactNode } from 'react'

// Hoisted so the mock factory (which vitest lifts above imports) and the test
// bodies share one spy. `state.mode` lets a single test flip the translator
// between "English default" and "raw key" output to simulate a language
// switch without a second render tree.
const h = vi.hoisted(() => {
  const makeT = (mode: 'fallback' | 'key') =>
    vi.fn((key: string, fallback?: unknown) => {
      if (mode === 'key') return key
      return typeof fallback === 'string' ? fallback : key
    })
  // `current` mirrors react-i18next: switching language hands out a NEW `t`
  // reference, which is exactly what drives the component's useMemo([t]) to
  // rebuild the guarantee list. Mutating behaviour in place (without a new
  // reference) would — correctly — be memoised away.
  const state = { current: makeT('fallback') }
  const reset = () => {
    state.current = makeT('fallback')
  }
  const switchLanguage = () => {
    state.current = makeT('key')
  }
  return { state, reset, switchLanguage }
})

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: h.state.current,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { ImpersonationPolicyPanel } from './ImpersonationPolicyPanel'

const ITEM_IDS = ['audit', 'ttl', 'sudo', 'forwardAuth', 'exit'] as const

const TITLES = [
  'Every session is audit-logged',
  '15-minute time limit',
  'Step-up auth to start',
  'Forward-auth required',
  'End it any time',
]

function renderPanel() {
  return render(<ImpersonationPolicyPanel />)
}

beforeEach(() => {
  h.reset()
})

describe('ImpersonationPolicyPanel', () => {
  it('renders the panel heading and the constrained intro copy', () => {
    renderPanel()

    expect(
      screen.getByTestId('impersonation-policy-panel'),
    ).toBeInTheDocument()

    // PanelTitle renders an <h3>; the leading icon is decorative so the
    // accessible name is just the title text.
    expect(
      screen.getByRole('heading', { level: 3, name: 'How impersonation works' }),
    ).toBeInTheDocument()

    expect(
      screen.getByText(/Impersonation lets an admin view TeslaSync/i),
    ).toBeInTheDocument()
  })

  it('renders every guarantee (titles + bodies) as five list items', () => {
    renderPanel()

    for (const title of TITLES) {
      expect(screen.getByText(title)).toBeInTheDocument()
    }

    // Spot-check two bodies to prove the descriptive copy renders, not just
    // the headings.
    expect(
      screen.getByText(/writes an immutable entry to the admin audit log/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/expires automatically after 15 minutes/i),
    ).toBeInTheDocument()

    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  it('hides decorative icons from assistive tech and labels the list', () => {
    const { container } = renderPanel()

    // The list is programmatically labelled so screen-reader users know the
    // group's purpose even though the icons are hidden.
    expect(
      screen.getByRole('list', { name: 'Impersonation guarantees' }),
    ).toBeInTheDocument()

    // Heading icon is decorative.
    const heading = screen.getByRole('heading', { level: 3 })
    expect(heading.querySelector('[aria-hidden="true"]')).not.toBeNull()

    // Every guarantee wraps its icon in an aria-hidden span, so the row's
    // accessible content is just the title + body.
    const rows = screen.getAllByRole('listitem')
    for (const row of rows) {
      expect(row.querySelector('[aria-hidden="true"]')).not.toBeNull()
    }

    // 1 heading icon + 5 row icons are all hidden from the a11y tree.
    expect(
      container.querySelectorAll('[aria-hidden="true"]').length,
    ).toBeGreaterThanOrEqual(6)
  })

  it('exposes stable, translation-independent test ids for each guarantee', () => {
    renderPanel()

    const list = screen.getByTestId('impersonation-policy-list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(5)

    for (const id of ITEM_IDS) {
      expect(
        screen.getByTestId(`impersonation-policy-item-${id}`),
      ).toBeInTheDocument()
    }
  })

  it('wires every visible string through i18n with an English default', () => {
    renderPanel()

    expect(h.state.current).toHaveBeenCalledWith(
      'impersonation.policy.title',
      'How impersonation works',
    )
    expect(h.state.current).toHaveBeenCalledWith(
      'impersonation.policy.intro',
      expect.stringContaining('Impersonation lets an admin view TeslaSync'),
    )
    expect(h.state.current).toHaveBeenCalledWith(
      'impersonation.policy.audit.title',
      'Every session is audit-logged',
    )
    // The a11y list label added during hardening must also be translatable.
    expect(h.state.current).toHaveBeenCalledWith(
      'impersonation.policy.listLabel',
      'Impersonation guarantees',
    )
  })

  it('relabels each card in place on a language switch (stable key, no remount)', () => {
    const { rerender } = renderPanel()

    // Capture the DOM node for the audit card while the translator emits the
    // English default.
    const before = screen.getByTestId('impersonation-policy-item-audit')
    expect(before).toHaveTextContent('Every session is audit-logged')

    // Simulate a language change: react-i18next hands out a new `t` reference,
    // which flips the component's useMemo([t]) so every title/body string
    // changes. The stable `id`-based React key must keep the same <li> node —
    // the old `key={item.title}` implementation would have remounted it into a
    // brand-new node.
    h.switchLanguage()
    rerender(<ImpersonationPolicyPanel />)

    const after = screen.getByTestId('impersonation-policy-item-audit')
    expect(after).toBe(before)
    expect(after).toHaveTextContent('impersonation.policy.audit.title')
    expect(
      screen.queryByText('Every session is audit-logged'),
    ).not.toBeInTheDocument()
  })
})
