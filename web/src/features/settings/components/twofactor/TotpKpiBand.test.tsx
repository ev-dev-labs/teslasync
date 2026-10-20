/**
 * TotpKpiBand — the always-on four-card status strip at the top of the
 * two-factor settings surface. It is self-sufficient: it owns its own
 * loading skeleton and degrades every field null-safely, so the band is
 * the single source of truth for "is 2FA protecting this account, and
 * how healthy is the credential".
 *
 * The contract pinned here exercises every branch of the band:
 *   • loading retains metric labels with static value placeholders,
 *     suppresses measured-value claims, and keeps the labelled landmark region so
 *     the summary never loses its accessible name mid-fetch;
 *   • open-mode (the install has no forward-auth header) and a missing
 *     `data` object both collapse the status card to "Unavailable" and omit
 *     the two per-user tiles (counted in the drawer), never invoking the date formatter;
 *   • an activated session renders "Active", forwards its raw `last_used_at`
 *     ISO string to `formatDateTime` verbatim, and renders the formatter's
 *     result as the "Last verified" cell;
 *   • an activated session with missing or invalid use evidence stays unknown and never
 *     calls the formatter;
 *   • a session that exists but is not activated renders "Not enrolled" and
 *     omits the two per-user tiles (counted in the drawer);
 *   • null-safety: a malformed session missing `backup_codes_remaining`
 *     omits the tile rather than inventing zero,
 *     and a genuine zero backup-code balance renders "0" — distinct from the
 *     omitted tile a non-activated credential shows, so an exhausted balance
 *     is never silently hidden;
 *   • design-language §8 "always visible": every non-loading state renders
 *     its known-value tiles plus the counted hidden-fields explanation, never
 *     a blank panel;
 *   • a11y: the band is a labelled region and every lucide glyph is
 *     decorative and hidden from assistive tech.
 *
 * `useDateFormat` is stubbed so `formatDateTime` echoes a deterministic,
 * timezone-stable token and we can assert its argument is forwarded
 * unmodified. react-i18next is mocked to echo the English fallback so the
 * labels are deterministic. framer-motion is mocked to a passthrough because
 * the `@/components/data-display` barrel this file pulls in ships
 * motion-driven components; the mock keeps module load hermetic even though
 * the band renders no motion itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions'

import type { TOTPStatus } from '@/api/types'

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: 'km', speed: 'km/h', temperature: '°C',
    pressure: 'bar', energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US', precision: 2 } }),
}))
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}))
// Deterministic date formatting: the real useDateFormat threads user settings
// + timezone; stubbing it pins that `formatDateTime` receives the raw ISO
// string verbatim and lets us assert an exact, timezone-stable cell value.
const { formatDateTime } = vi.hoisted(() => ({
  formatDateTime: vi.fn((value: unknown) => `fmt:${String(value)}`),
}))
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatDateTime }),
}))

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: Record<string, unknown>) => {
        const Component = (props.as as string) ?? 'div'
        const { children, ...rest } = props as { children?: unknown } & Record<string, unknown>
        return <Component {...(rest as Record<string, unknown>)}>{children as ReactNode}</Component>
      },
    },
  ),
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useReducedMotion: () => true,
  useInView: () => true,
  useMotionValue: (v: unknown) => ({ get: () => v, set: vi.fn(), on: vi.fn() }),
  useSpring: (v: unknown) => ({ get: () => v, set: vi.fn(), on: vi.fn() }),
  useTransform: () => ({ get: () => 0, set: vi.fn(), on: vi.fn() }),
  animate: vi.fn(() => ({ stop: vi.fn() })),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, opts?: Record<string, unknown>) => {
      let out = fallback ?? _key
      if (opts) {
        // Match the shared plural-capable fixture: counted sentences honour
        // one/other defaults so the drawer's hidden-count reads correctly.
        if (typeof opts.count === 'number' && (opts.defaultValue_one != null || opts.defaultValue_other != null)) {
          out = String(opts.count === 1 ? (opts.defaultValue_one ?? out) : (opts.defaultValue_other ?? out))
        }
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v))
        }
      }
      return out
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}))

import { TotpKpiBand } from './TotpKpiBand'

type SessionStatus = Extract<TOTPStatus, { mode: 'session' }>

/** Build a well-formed activated session status; every field is overridable. */
function sessionStatus(over: Partial<SessionStatus> = {}): TOTPStatus {
  return {
    mode: 'session',
    activated: true,
    backup_codes_remaining: 7,
    last_used_at: '2026-02-01T10:00:00Z',
    ...over,
  }
}

/** All four card labels, in render order (English fallbacks). */
const LABELS = ['Protection', 'Last verified', 'Backup codes remaining', 'Method'] as const

const REGION_NAME = 'Two-factor status summary'

function briefRegion(): HTMLElement {
  return screen.getByRole('region', { name: REGION_NAME })
}

// Unknown readings are omitted from the brief face; the Review-details
// drawer counts them. Pins the exact hidden-count sentence.
function expectHiddenCount(region: HTMLElement, text: string) {
  fireEvent.click(within(region).getByRole('button', { name: 'Review details' }))
  const drawer = screen.getByRole('dialog')
  try {
    expect(within(drawer).getByText(text)).toBeInTheDocument()
  } finally {
    fireEvent.keyDown(drawer, { key: 'Escape' })
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
}

beforeEach(() => {
  formatDateTime.mockClear()
})

describe('TotpKpiBand', () => {
  it('retains the Brief labels while loading and suppresses measured-value claims', () => {
    const { container } = render(<TotpKpiBand data={undefined} isLoading />)

    // Metric labels remain visible while their values are loading.
    for (const label of LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    // The Brief uses static decorative value placeholders, not pulse animations.
    expect(container.querySelectorAll('[data-operational-metric] span[aria-hidden="true"][class*="--surface-3"]').length).toBeGreaterThanOrEqual(4)
    expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0)
    // The formatter is never touched while there is no data.
    expect(formatDateTime).not.toHaveBeenCalled()
  })

  it('keeps the labelled summary region present in both the loading and loaded states', () => {
    const loading = render(<TotpKpiBand data={undefined} isLoading />)
    expect(loading.getByRole('region', { name: REGION_NAME })).toBeInTheDocument()
    loading.unmount()

    render(<TotpKpiBand data={sessionStatus()} isLoading={false} />)
    expect(screen.getByRole('region', { name: REGION_NAME })).toBeInTheDocument()
  })

  it('renders the full four-card band with an activated session (§8 always visible)', () => {
    render(<TotpKpiBand data={sessionStatus()} isLoading={false} />)

    for (const label of LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('shows "Active" and forwards the raw last_used_at ISO string to the formatter verbatim', () => {
    render(
      <TotpKpiBand
        data={sessionStatus({ last_used_at: '2026-12-31T23:59:00Z', backup_codes_remaining: 7 })}
        isLoading={false}
      />,
    )

    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(formatDateTime).toHaveBeenCalledWith('2026-12-31T23:59:00Z')
    expect(screen.getByText('fmt:2026-12-31T23:59:00Z')).toBeInTheDocument()
    // Backup balance is surfaced verbatim for an activated credential.
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it.each([undefined, '', '   ', 'not-a-date', '2026-13-01T10:00:00Z'])(
    'keeps missing or invalid verification evidence %s unknown rather than claiming never-used',
    last_used_at => {
      render(<TotpKpiBand data={sessionStatus({ last_used_at })} isLoading={false} />)

      expect(screen.getByText('Active')).toBeInTheDocument()
      const region = briefRegion()
      assertOperationalMetricUnavailable(region, 'Last verified')
      expectHiddenCount(region, '1 empty field is hidden.')
      expect(screen.queryByText('Never')).not.toBeInTheDocument()
      expect(formatDateTime).not.toHaveBeenCalled()
    },
  )

  it('renders "Not enrolled" and dashes the per-user cells for a session that is not activated', () => {
    render(<TotpKpiBand data={sessionStatus({ activated: false })} isLoading={false} />)

    expect(screen.getByText('Not enrolled')).toBeInTheDocument()
    // Last-verified and backup-codes tiles are omitted when the credential is not activated.
    const region = briefRegion()
    assertOperationalMetricUnavailable(region, 'Last verified')
    assertOperationalMetricUnavailable(region, 'Backup codes remaining')
    expectHiddenCount(region, '2 empty fields are hidden.')
    // A non-activated credential never has a verification time to format.
    expect(formatDateTime).not.toHaveBeenCalled()
  })

  it('collapses to "Unavailable" with two dashes in open mode, without calling the formatter', () => {
    render(<TotpKpiBand data={{ mode: 'open' }} isLoading={false} />)

    const region = briefRegion()
    for (const label of ['Protection', 'Method'] as const) {
      expect(within(region).getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    // Method is always a static TOTP value, even when unavailable; its
    // RFC 6238 standard context lives in the Review-details drawer.
    expect(screen.getByText('TOTP')).toBeInTheDocument()
    fireEvent.click(within(region).getByRole('button', { name: 'Review details' }))
    const drawer = screen.getByRole('dialog')
    try {
      const methodGroup = within(drawer).getByRole('group', { name: 'Method' })
      expect(within(methodGroup).getByText('RFC 6238')).toBeInTheDocument()
    } finally {
      fireEvent.keyDown(drawer, { key: 'Escape' })
    }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    assertOperationalMetricUnavailable(region, 'Last verified')
    assertOperationalMetricUnavailable(region, 'Backup codes remaining')
    expectHiddenCount(region, '2 empty fields are hidden.')
    expect(formatDateTime).not.toHaveBeenCalled()
  })

  it('treats a missing data object (not loading) as unavailable rather than a blank panel', () => {
    render(<TotpKpiBand data={undefined} isLoading={false} />)

    const region = briefRegion()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(within(region).getByText('Protection')).toBeInTheDocument()
    expect(within(region).getByText('Method')).toBeInTheDocument()
    assertOperationalMetricUnavailable(region, 'Last verified')
    assertOperationalMetricUnavailable(region, 'Backup codes remaining')
    expectHiddenCount(region, '2 empty fields are hidden.')
  })

  it('keeps a missing backup balance unknown instead of inventing an exhausted balance', () => {
    render(
      <TotpKpiBand
        data={{ mode: 'session', activated: true } as TOTPStatus}
        isLoading={false}
      />,
    )

    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.queryByText('Never')).not.toBeInTheDocument()
    const region = briefRegion()
    assertOperationalMetricUnavailable(region, 'Last verified')
    assertOperationalMetricUnavailable(region, 'Backup codes remaining')
    expectHiddenCount(region, '2 empty fields are hidden.')
    expect(formatDateTime).not.toHaveBeenCalled()
  })

  it.each([
    -5, -0.5, 0.5, 7.5, Number.NaN, Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER,
  ])('keeps invalid backup balance %s unknown in the summary', backup_codes_remaining => {
    render(<TotpKpiBand data={sessionStatus({ backup_codes_remaining })} isLoading={false} />)

    const region = briefRegion()
    assertOperationalMetricUnavailable(region, 'Backup codes remaining')
    expectHiddenCount(region, '1 empty field is hidden.')
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.getByText('fmt:2026-02-01T10:00:00Z')).toBeInTheDocument()
  })

  it('renders an exhausted backup balance as "0" — distinct from the "—" of a disabled credential', () => {
    render(
      <TotpKpiBand
        data={sessionStatus({ backup_codes_remaining: 0, last_used_at: '2026-02-01T10:00:00Z' })}
        isLoading={false}
      />,
    )

    // Zero remaining codes is a real, actionable value — it must render "0".
    expect(screen.getByText('0')).toBeInTheDocument()
    // With an activated credential and a recorded use there is no dash at all.
    expect(screen.queryByText('—')).not.toBeInTheDocument()
    expect(screen.getByText('fmt:2026-02-01T10:00:00Z')).toBeInTheDocument()
  })

  it('hides its decorative lucide icons from assistive technology (a11y)', () => {
    render(<TotpKpiBand data={sessionStatus()} isLoading={false} />)

    // The four metric glyphs live in the Review-details drawer contexts now;
    // each stays decorative (aria-hidden) with no accessible name of its own.
    const region = briefRegion()
    fireEvent.click(within(region).getByRole('button', { name: 'Review details' }))
    const drawer = screen.getByRole('dialog')
    try {
      const hidden = drawer.querySelectorAll('[aria-hidden="true"]')
      expect(hidden.length).toBeGreaterThanOrEqual(4)
    } finally {
      fireEvent.keyDown(drawer, { key: 'Escape' })
    }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
