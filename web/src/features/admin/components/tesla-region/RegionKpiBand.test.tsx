/**
 * RegionKpiBand contract tests.
 *
 * The KPI band is a prop-driven presentational strip summarising the Tesla
 * account's Fleet API region as a four-card metric grid. The behaviour locked
 * in here:
 *
 *   1. Loading — while `isLoading`, only the stat-grid skeleton renders
 *      (role="status" / aria-busy) and none of the KPI cards mount.
 *   2. Layout & a11y — once resolved, all four labelled cards always render,
 *      each with a decorative (aria-hidden) icon, so the band never disappears.
 *   3. Value surfacing — region key + protocol are upper-cased, the endpoint
 *      status reflects `configured`, and the synced timestamp is delegated to
 *      `formatRelative` with the parsed `fetchedAt` instant.
 *   4. Null-safety — null region / scheme / synced collapse to an em dash, a
 *      null region label falls back to "Not detected", and an unconfigured
 *      account shows "Not configured" instead of a blank card.
 *   5. Hardening — an empty / whitespace-only region label (a malformed prop)
 *      must ALSO fall back to "Not detected" rather than rendering a blank
 *      subtitle (the trimmed-guard fix on the source).
 *
 * react-i18next is stubbed to echo the English fallback so the copy asserted
 * on is decoupled from the locale bundle. `useDateFormat` is mocked to a
 * deterministic `formatRelative` — the same hermetic convention as
 * tesla-orders/DeliveryOutlookPanel.test.tsx — so no QueryClient, timezone
 * router context, or real clock is required. <MetricCard> and
 * <StatGridSkeleton> render for real (stable shared primitives with their own
 * tests), so the assertions exercise the true label → value → subtitle → icon
 * wiring end-to-end.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Hoisted so the vi.mock factory below can reference it (vitest hoists both).
const { formatRelativeMock } = vi.hoisted(() => ({
  formatRelativeMock: vi.fn((_value?: unknown) => 'synced-relative'),
}))

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    opts: { locale: 'en-US', tz: 'UTC' },
    tz: 'UTC',
    locale: 'en-US',
    formatDate: (v: unknown) => String(v),
    formatDateTime: () => 'dt',
    formatTime: () => 't',
    formatDateShort: () => 's',
    formatDateWithDay: () => 'd',
    formatRelative: formatRelativeMock,
    formatRelativeTime: () => 'rt',
    formatRelativeDays: () => 'rd',
  }),
}))

import { RegionKpiBand, type RegionKpiBandProps } from './RegionKpiBand'

// The em dash the source uses for null-safe placeholders (U+2014).
const EM_DASH = '—'

function renderBand(overrides: Partial<RegionKpiBandProps> = {}) {
  const props: RegionKpiBandProps = {
    regionKey: 'eu',
    regionLabel: 'Europe, Middle East & Africa',
    scheme: 'https',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    configured: true,
    isLoading: false,
    ...overrides,
  }
  return render(<RegionKpiBand {...props} />)
}

/** Assert all four card labels are on screen regardless of the values. */
function expectAllFourCards() {
  expect(screen.getByText('Region')).toBeInTheDocument()
  expect(screen.getByText('Endpoint')).toBeInTheDocument()
  expect(screen.getByText('Protocol')).toBeInTheDocument()
  expect(screen.getByText('Last synced')).toBeInTheDocument()
}

beforeEach(() => {
  formatRelativeMock.mockClear()
})

// ── Loading ───────────────────────────────────────────────────────────────────

describe('RegionKpiBand — loading', () => {
  it('renders only the stat-grid skeleton while loading, withholding the cards', () => {
    renderBand({ isLoading: true })

    const skeleton = screen.getByTestId('stat-grid-skeleton')
    expect(skeleton).toBeInTheDocument()
    expect(skeleton).toHaveAttribute('role', 'status')
    expect(skeleton).toHaveAttribute('aria-busy', 'true')

    // None of the KPI cards mount on the loading path.
    expect(screen.queryByText('Region')).toBeNull()
    expect(screen.queryByText('Last synced')).toBeNull()
    // The date formatter must not run before data resolves.
    expect(formatRelativeMock).not.toHaveBeenCalled()
  })

  it('renders four skeleton placeholder cards to mirror the resolved band', () => {
    renderBand({ isLoading: true })

    const skeleton = screen.getByTestId('stat-grid-skeleton')
    expect(skeleton.children).toHaveLength(4)
  })
})

// ── Layout & accessibility ──────────────────────────────────────────────────────

describe('RegionKpiBand — layout & accessibility', () => {
  it('renders all four labelled cards, each with a decorative icon', () => {
    const { container } = renderBand()

    expectAllFourCards()
    // Every card glyph is aria-hidden so a screen reader announces the
    // label + value, never the decorative icon.
    const icons = container.querySelectorAll('svg[aria-hidden="true"]')
    expect(icons).toHaveLength(4)
  })

  it('renders the static hint subtitle for every card', () => {
    renderBand()

    expect(screen.getByText('Tesla Fleet API')).toBeInTheDocument()
    expect(screen.getByText('Secure transport')).toBeInTheDocument()
    expect(screen.getByText('From Tesla account')).toBeInTheDocument()
  })
})

// ── Value surfacing ─────────────────────────────────────────────────────────────

describe('RegionKpiBand — value surfacing', () => {
  it('upper-cases the region key and protocol and surfaces the region label', () => {
    renderBand({
      regionKey: 'eu',
      scheme: 'https',
      regionLabel: 'Europe, Middle East & Africa',
    })

    expect(screen.getByText('EU')).toBeInTheDocument()
    expect(screen.getByText('HTTPS')).toBeInTheDocument()
    expect(screen.getByText('Europe, Middle East & Africa')).toBeInTheDocument()
  })

  it('shows "Configured" when the account has an endpoint on record', () => {
    renderBand({ configured: true })

    expect(screen.getByText('Configured')).toBeInTheDocument()
    expect(screen.queryByText('Not configured')).toBeNull()
  })

  it('delegates the synced timestamp to formatRelative with the fetchedAt instant', () => {
    renderBand({ fetchedAt: '2026-01-01T00:00:00.000Z' })

    expect(screen.getByText('synced-relative')).toBeInTheDocument()
    expect(formatRelativeMock).toHaveBeenCalledTimes(1)
    const arg = formatRelativeMock.mock.calls[0][0]
    expect(arg).toBeInstanceOf(Date)
    expect((arg as Date).toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })
})

// ── Null-safety & empty placeholders ────────────────────────────────────────────

describe('RegionKpiBand — null-safety & empty placeholders', () => {
  it('collapses null region / scheme / synced to an em dash and keeps every card', () => {
    renderBand({
      regionKey: null,
      regionLabel: null,
      scheme: null,
      fetchedAt: null,
      configured: false,
    })

    // The band never disappears — all four cards remain visible.
    expectAllFourCards()
    // regionValue, protocolValue and syncedValue each collapse to "—".
    expect(screen.getAllByText(EM_DASH)).toHaveLength(3)
    // Unconfigured endpoint + missing label fall back to copy, not a blank.
    expect(screen.getByText('Not configured')).toBeInTheDocument()
    expect(screen.getByText('Not detected')).toBeInTheDocument()
    // A null fetchedAt must not reach the formatter.
    expect(formatRelativeMock).not.toHaveBeenCalled()
  })
})

// ── Malformed region-label hardening (the surfaced bug) ─────────────────────────

describe('RegionKpiBand — malformed region label hardening', () => {
  it('falls back to "Not detected" for an empty-string region label', () => {
    renderBand({ regionKey: 'na', regionLabel: '' })

    expect(screen.getByText('NA')).toBeInTheDocument()
    // Empty string is not caught by `??`; the trim-guard must still fall back.
    expect(screen.getByText('Not detected')).toBeInTheDocument()
  })

  it('falls back to "Not detected" for a whitespace-only region label', () => {
    renderBand({ regionKey: 'na', regionLabel: '   ' })

    expect(screen.getByText('Not detected')).toBeInTheDocument()
  })
})
