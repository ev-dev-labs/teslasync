/**
 * TotpKpiBand — the always-on four-card status strip at the top of the
 * two-factor settings surface. It is self-sufficient: it owns its own
 * loading skeleton and degrades every field null-safely, so the band is
 * the single source of truth for "is 2FA protecting this account, and
 * how healthy is the credential".
 *
 * The contract pinned here exercises every branch of the band:
 *   • loading swaps the whole band for skeleton placeholders, mounts none
 *     of the metric labels, yet keeps the same labelled landmark region so
 *     the summary never loses its accessible name mid-fetch;
 *   • open-mode (the install has no forward-auth header) and a missing
 *     `data` object both collapse the status card to "Unavailable" and the
 *     two per-user cells to an em-dash, and never invoke the date formatter;
 *   • an activated session renders "Active", forwards its raw `last_used_at`
 *     ISO string to `formatDateTime` verbatim, and renders the formatter's
 *     result as the "Last verified" cell;
 *   • an activated session with no recorded use shows "Never" and never
 *     calls the formatter;
 *   • a session that exists but is not activated renders "Not enrolled" and
 *     dashes out the two per-user cells;
 *   • null-safety: a malformed session missing `backup_codes_remaining`
 *     degrades to `0` (proving the `?? 0` guard) rather than a blank cell,
 *     and a genuine zero backup-code balance renders "0" — distinct from the
 *     "—" a non-activated credential shows, so an exhausted balance is never
 *     silently hidden;
 *   • design-language §8 "always visible": every non-loading state renders
 *     the full four-card band, never a blank panel;
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
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

import type { TOTPStatus } from '@/api/types'

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

beforeEach(() => {
  formatDateTime.mockClear()
})

describe('TotpKpiBand', () => {
  it('swaps the band for skeleton placeholders while loading and mounts no metric labels', () => {
    const { container } = render(<TotpKpiBand data={undefined} isLoading />)

    // None of the metric cards are mounted during the loading branch.
    for (const label of LABELS) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
    // Skeleton placeholders stand in for the cards (one pulse per skeleton bar).
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(4)
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

  it('shows "Never" and never calls the formatter when an activated session has no recorded use', () => {
    render(<TotpKpiBand data={sessionStatus({ last_used_at: undefined })} isLoading={false} />)

    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Never')).toBeInTheDocument()
    expect(formatDateTime).not.toHaveBeenCalled()
  })

  it('renders "Not enrolled" and dashes the per-user cells for a session that is not activated', () => {
    render(<TotpKpiBand data={sessionStatus({ activated: false })} isLoading={false} />)

    expect(screen.getByText('Not enrolled')).toBeInTheDocument()
    // Last-verified and backup-codes cells both collapse to an em-dash.
    expect(screen.getAllByText('—')).toHaveLength(2)
    // A non-activated credential never has a verification time to format.
    expect(formatDateTime).not.toHaveBeenCalled()
  })

  it('collapses to "Unavailable" with two dashes in open mode, without calling the formatter', () => {
    render(<TotpKpiBand data={{ mode: 'open' }} isLoading={false} />)

    for (const label of LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    // Method is always a static TOTP / RFC 6238 pair, even when unavailable.
    expect(screen.getByText('TOTP')).toBeInTheDocument()
    expect(screen.getByText('RFC 6238')).toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(2)
    expect(formatDateTime).not.toHaveBeenCalled()
  })

  it('treats a missing data object (not loading) as unavailable rather than a blank panel', () => {
    render(<TotpKpiBand data={undefined} isLoading={false} />)

    expect(screen.getByRole('region', { name: REGION_NAME })).toBeInTheDocument()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    for (const label of LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('is null-safe: a session missing backup_codes_remaining degrades to 0, not a blank cell', () => {
    // A stale/partial cached shape: activated, but the numeric aggregate and
    // last-used timestamp are absent. The `?? 0` guard must keep the cell
    // populated and the missing timestamp must resolve to "Never".
    render(
      <TotpKpiBand
        data={{ mode: 'session', activated: true } as TOTPStatus}
        isLoading={false}
      />,
    )

    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('Never')).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
    expect(formatDateTime).not.toHaveBeenCalled()
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
    const { container } = render(<TotpKpiBand data={sessionStatus()} isLoading={false} />)

    // One decorative glyph per card → at least four aria-hidden icons.
    const hidden = container.querySelectorAll('[aria-hidden="true"]')
    expect(hidden.length).toBeGreaterThanOrEqual(4)
  })
})
