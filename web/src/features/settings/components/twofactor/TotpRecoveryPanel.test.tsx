/**
 * TotpRecoveryPanel contract.
 *
 * TotpRecoveryPanel is a static, data-free "recovery & good habits" panel for
 * the two-factor page context band. It takes no props and reads every string
 * through react-i18next (the `settings` namespace), so the coverage here pins
 * the facets that actually matter for a presentational component:
 *
 *   1. structure — the panel header (heading + subtitle) is never a blank
 *      surface; the title is the h3 panel heading.
 *   2. content   — all three recovery tips render their copy inside a single
 *      three-item list (no dropped / duplicated rows).
 *   3. a11y      — the four glyphs (header life-buoy + three tips) are
 *      decorative and aria-hidden; the panel exposes itself as a region
 *      landmark whose accessible name is wired from the heading via
 *      aria-labelledby (not a duplicated aria-label).
 *   4. i18n      — copy is translation-driven: the component reads from the
 *      `settings` namespace and passes the exact keys + inline English
 *      fallbacks, and it renders whatever the resolver returns (nothing is
 *      hardcoded).
 *   5. exports   — the default export is the same component as the named one.
 *
 * `react-i18next` is stubbed with a hoisted spy so `t` deterministically
 * returns the inline English fallback and the key/namespace wiring can be
 * asserted directly — no i18n catalogue, QueryClient, Router or network needed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

const { tSpy, useTranslationSpy } = vi.hoisted(() => {
  const tSpy = vi.fn((key: string, fallback?: unknown) =>
    typeof fallback === 'string' ? fallback : key,
  )
  const useTranslationSpy = vi.fn((_ns?: string) => ({
    t: tSpy,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }))
  return { tSpy, useTranslationSpy }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: useTranslationSpy,
  }
})

import { TotpRecoveryPanel } from './TotpRecoveryPanel'
import TotpRecoveryPanelDefault from './TotpRecoveryPanel'

const TITLE = 'Recovery & good habits'
const SUBTITLE = 'Keep a way back in if you lose your phone.'
const TIP1 = 'Each backup code works once — regenerate when you are running low.'
const TIP2 = 'Store codes in your password manager, not next to your authenticator app.'
const TIP3 = 'Codes rotate every 30 seconds; if one is rejected, wait for the next.'

beforeEach(() => {
  useTranslationSpy.mockClear()
  // Reset call history AND restore the default fallback resolver so a test
  // that swaps the implementation cannot leak into the next one.
  tSpy.mockReset()
  tSpy.mockImplementation((key: string, fallback?: unknown) =>
    typeof fallback === 'string' ? fallback : key,
  )
})

describe('TotpRecoveryPanel — structure', () => {
  it('always renders the panel heading and subtitle', () => {
    render(<TotpRecoveryPanel />)
    expect(screen.getByRole('heading', { level: 3, name: TITLE })).toBeInTheDocument()
    expect(screen.getByText(SUBTITLE)).toBeInTheDocument()
  })
})

describe('TotpRecoveryPanel — content', () => {
  it('renders all three recovery tips in a single three-item list', () => {
    render(<TotpRecoveryPanel />)

    expect(screen.getByText(TIP1)).toBeInTheDocument()
    expect(screen.getByText(TIP2)).toBeInTheDocument()
    expect(screen.getByText(TIP3)).toBeInTheDocument()

    const list = screen.getByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
  })
})

describe('TotpRecoveryPanel — accessibility', () => {
  it('hides every decorative icon from assistive technology', () => {
    const { container } = render(<TotpRecoveryPanel />)
    const svgs = container.querySelectorAll('svg')
    // 1 header life-buoy + 3 per-tip glyphs, all purely decorative.
    expect(svgs).toHaveLength(4)
    svgs.forEach((svg) => expect(svg).toHaveAttribute('aria-hidden', 'true'))
  })

  it('exposes the panel as a region labelled by its heading (not aria-label)', () => {
    render(<TotpRecoveryPanel />)

    const region = screen.getByRole('region', { name: TITLE })
    expect(region).toBeInTheDocument()
    expect(region).not.toHaveAttribute('aria-label')

    // The name is derived from the heading via aria-labelledby, so the panel's
    // pointer and the heading's id must be the same non-empty token.
    const heading = screen.getByRole('heading', { level: 3, name: TITLE })
    expect(heading.id).toBeTruthy()
    expect(region.getAttribute('aria-labelledby')).toBe(heading.id)
  })
})

describe('TotpRecoveryPanel — i18n wiring', () => {
  it('reads from the settings namespace via the exact keys and fallbacks', () => {
    render(<TotpRecoveryPanel />)

    expect(useTranslationSpy).toHaveBeenCalledWith('settings')
    expect(tSpy).toHaveBeenCalledWith('totp.recovery.title', TITLE)
    expect(tSpy).toHaveBeenCalledWith('totp.recovery.subtitle', SUBTITLE)
    expect(tSpy).toHaveBeenCalledWith('totp.recovery.tip1', TIP1)
    expect(tSpy).toHaveBeenCalledWith('totp.recovery.tip2', TIP2)
    expect(tSpy).toHaveBeenCalledWith('totp.recovery.tip3', TIP3)
  })

  it('renders whatever the resolver returns, proving copy is not hardcoded', () => {
    tSpy.mockImplementation((key: string) => `xx:${key}`)
    render(<TotpRecoveryPanel />)

    expect(
      screen.getByRole('heading', { level: 3, name: 'xx:totp.recovery.title' }),
    ).toBeInTheDocument()
    expect(screen.getByText('xx:totp.recovery.tip1')).toBeInTheDocument()
    expect(screen.getByText('xx:totp.recovery.tip3')).toBeInTheDocument()
    // The English defaults must NOT survive once the resolver overrides them.
    expect(screen.queryByText(TIP1)).toBeNull()
  })
})

describe('TotpRecoveryPanel — exports', () => {
  it('exposes the same component through the default export', () => {
    expect(TotpRecoveryPanelDefault).toBe(TotpRecoveryPanel)

    render(<TotpRecoveryPanelDefault />)
    expect(screen.getByRole('heading', { level: 3, name: TITLE })).toBeInTheDocument()
  })
})
