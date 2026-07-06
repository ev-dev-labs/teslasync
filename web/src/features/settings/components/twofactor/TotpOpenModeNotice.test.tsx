/**
 * TotpOpenModeNotice — open-mode placeholder contract.
 *
 * This surface is what the two-factor page shows when the backend reports
 * AUTH_MODE_OPEN: per-user TOTP needs forward-auth, so NO enroll/disable
 * controls may appear here. It is a pure presentational component — no props,
 * no network, no data branches — so the contract worth locking down is:
 *   1. it paints the localized title (h3) + the forward-auth guidance copy;
 *   2. it pulls copy from the `settings` i18n namespace (the wrong namespace
 *      would silently fall back to raw keys in production);
 *   3. it exposes a `role="status"` polite live region so assistive tech
 *      ANNOUNCES the mode when it replaces the loading spinner, while the
 *      warning glyph stays decorative (aria-hidden);
 *   4. it offers ZERO actionable controls (no enroll/disable/verify) — the
 *      whole point of the open-mode gate;
 *   5. the default export is the same component as the named export.
 *
 * react-i18next is stubbed (repo-wide convention) to echo each key's fallback
 * string so the copy is deterministic without booting the i18n runtime. The
 * `useTranslation` stub is a hoisted spy so the namespace can be asserted.
 * The component only pulls in pure presentational primitives (GlassPanel,
 * IconBox, Heading, HelperText), so a bare render() needs no providers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

const { useTranslationSpy } = vi.hoisted(() => ({
  useTranslationSpy: vi.fn((_ns?: string) => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  })),
}))

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: (ns?: string) => useTranslationSpy(ns),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import TotpOpenModeNotice, { TotpOpenModeNotice as NamedNotice } from './TotpOpenModeNotice'

const TITLE = 'Two-factor authentication'
const MESSAGE =
  'Per-user TOTP requires forward-auth mode. Configure your reverse proxy to inject X-Forwarded-User then reload.'

beforeEach(() => {
  useTranslationSpy.mockClear()
})

describe('TotpOpenModeNotice', () => {
  it('renders the localized title as an h3 and the forward-auth guidance copy', () => {
    render(<NamedNotice />)

    expect(
      screen.getByRole('heading', { level: 3, name: TITLE }),
    ).toBeInTheDocument()
    expect(screen.getByText(MESSAGE)).toBeInTheDocument()
    // Stable contract used by the parent (TOTPEnrollmentSection / page) tests.
    expect(screen.getByTestId('totp-section-open-mode')).toBeInTheDocument()
  })

  it('reads its copy from the `settings` i18n namespace', () => {
    render(<NamedNotice />)

    // Wrong namespace = silent fallback to raw keys in production.
    expect(useTranslationSpy).toHaveBeenCalledWith('settings')
    expect(useTranslationSpy).toHaveBeenCalledTimes(1)
  })

  it('exposes a polite status region that owns both the heading and message', () => {
    render(<NamedNotice />)

    const status = screen.getByRole('status')
    // The live region IS the panel — announced when it replaces the spinner.
    expect(status).toBe(screen.getByTestId('totp-section-open-mode'))
    expect(within(status).getByRole('heading', { level: 3, name: TITLE })).toBeInTheDocument()
    expect(within(status).getByText(MESSAGE)).toBeInTheDocument()
  })

  it('keeps the warning glyph decorative (aria-hidden) so it is not double-announced', () => {
    const { container } = render(<NamedNotice />)

    const icon = container.querySelector('svg[aria-hidden="true"]')
    expect(icon).not.toBeNull()
    // The meaning lives in the text, so no visible icons are exposed to AT.
    expect(container.querySelectorAll('svg[aria-hidden="false"]')).toHaveLength(0)
  })

  it('offers no actionable controls — the open-mode gate is view-only', () => {
    render(<NamedNotice />)

    // No enroll / disable / regenerate buttons, links, or verify inputs.
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('exports the same component as the default and named exports', () => {
    expect(TotpOpenModeNotice).toBe(NamedNotice)

    // The default export renders the identical, self-contained surface.
    render(<TotpOpenModeNotice />)
    expect(screen.getByRole('heading', { level: 3, name: TITLE })).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
