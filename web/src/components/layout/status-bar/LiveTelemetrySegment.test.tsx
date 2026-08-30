import type { ComponentProps } from 'react'
import { act, render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveTelemetrySegment } from './LiveTelemetrySegment'
import { StatusBarProvider } from './StatusBarContext'
import type { LiveConnectionState } from '@/hooks/useLiveConnection'

// ── Controllable live-connection state ────────────────────────────────────────
let mockState: LiveConnectionState

vi.mock('@/hooks/useLiveConnection', () => ({
  useLiveConnection: () => mockState,
}))

// Interpolating i18n stub — returns the English fallback and expands the
// `{{age}}` placeholder used by the tooltip's "Last message {{age}} ago" key.
// We spread the real module so transitive consumers pulled in through the
// `@/components/ui` barrel (Tooltip) keep their other exports.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback: string, opts?: Record<string, unknown>) =>
        opts
          ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(opts[k] ?? ''))
          : fallback,
    }),
  }
})

/** Fixed "now" so freshness math is deterministic. */
const NOW = new Date('2026-07-05T12:00:00.000Z').getTime()

function setState(
  status: LiveConnectionState['status'],
  lastMessageAt: string | null = null,
) {
  const sse: LiveConnectionState['channels']['sse'] =
    status === 'connected' ? 'open' : status === 'disconnected' ? 'error' : 'closed'
  mockState = { status, lastMessageAt, channels: { sse } }
}

/** ISO string for a timestamp `offsetMs` in the past relative to NOW. */
const agoIso = (offsetMs: number) => new Date(NOW - offsetMs).toISOString()

function renderSegment(props: Partial<ComponentProps<typeof LiveTelemetrySegment>> = {}) {
  return render(
    <MemoryRouter>
      <LiveTelemetrySegment {...props} />
    </MemoryRouter>,
  )
}

const getLink = () => screen.getByRole('link')

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  setState('connected', agoIso(5_000))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('LiveTelemetrySegment', () => {
  it('renders the connected state: Live label, emerald text, static Wifi icon, emerald dot and freshness', () => {
    setState('connected', agoIso(5_000))
    renderSegment()

    const link = getLink()
    expect(link).toHaveAttribute('href', '/signal-diff')
    expect(link).toHaveAttribute('aria-label', 'Live telemetry status: Live')
    expect(link.className).toContain('text-emerald-300')

    // Visible short label + inline freshness age.
    expect(within(link).getByText('Live')).toBeInTheDocument()
    expect(link).toHaveTextContent('5s')

    // Colored dot present, icon present, and NOT spinning when connected.
    expect(link.querySelector('.bg-emerald-400')).not.toBeNull()
    expect(link.querySelector('svg')).not.toBeNull()
    expect(link.querySelector('.animate-spin')).toBeNull()
  })

  it('renders the reconnecting state: amber label, spinning icon, amber dot and no inline age', () => {
    setState('reconnecting')
    renderSegment()

    const link = getLink()
    expect(link).toHaveTextContent('Reconnecting')
    expect(link.className).toContain('text-amber-300')
    expect(link.querySelector('.animate-spin')).not.toBeNull()
    expect(link.querySelector('.bg-amber-400')).not.toBeNull()
    // Freshness age is a connected-only affordance — the inline "·" must be absent.
    expect(link).not.toHaveTextContent('·')
  })

  it('classifies a connected stream older than two minutes as stale', () => {
    setState('connected', agoIso(120_000))
    renderSegment()

    const link = getLink()
    expect(link).toHaveTextContent('Stale')
    expect(link).toHaveTextContent('2m')
    expect(link).toHaveAttribute('aria-label', 'Live telemetry status: Stale')
    expect(link.className).toContain('text-amber-300')
    expect(link.querySelector('.bg-amber-400')).not.toBeNull()
  })

  it('transitions from Live to Stale on its local freshness cadence', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    setState('connected', agoIso(119_000))
    renderSegment()
    expect(getLink()).toHaveTextContent('Live')

    vi.setSystemTime(new Date(NOW + 10_000))
    act(() => vi.advanceTimersByTime(10_000))

    expect(getLink()).toHaveTextContent('Stale')
    expect(getLink()).toHaveTextContent('2m')
  })

  it('renders the disconnected state: rose Offline label + rose dot', () => {
    setState('disconnected')
    renderSegment()

    const link = getLink()
    expect(link).toHaveTextContent('Offline')
    expect(link).toHaveAttribute('aria-label', 'Live telemetry status: Offline')
    expect(link.className).toContain('text-rose-300')
    expect(link.querySelector('.bg-rose-400')).not.toBeNull()
  })

  it('announces meaningful status transitions through the separate live region', () => {
    const { rerender } = render(
      <StatusBarProvider announcementLabel="Status announcements">
        <MemoryRouter>
          <LiveTelemetrySegment />
        </MemoryRouter>
      </StatusBarProvider>,
    )
    setState('disconnected')
    rerender(
      <StatusBarProvider announcementLabel="Status announcements">
        <MemoryRouter>
          <LiveTelemetrySegment />
        </MemoryRouter>
      </StatusBarProvider>,
    )

    expect(
      screen.getByRole('status', { name: 'Status announcements' }),
    ).toHaveTextContent('Live telemetry status: Offline')
  })

  it('renders the unknown state as a muted "Idle" segment', () => {
    setState('unknown')
    renderSegment()

    const link = getLink()
    expect(link).toHaveTextContent('Idle')
    expect(link).toHaveAttribute('aria-label', 'Live telemetry status: Idle')
    expect(link.className).toContain('text-[var(--text-muted)]')
  })

  it('iconOnly hides the text label and freshness but keeps the accessible name, dot and icon', () => {
    setState('connected', agoIso(5_000))
    renderSegment({ iconOnly: true })

    const link = getLink()
    // No visible text at all in icon-only mode.
    expect(screen.queryByText('Live')).not.toBeInTheDocument()
    expect(link).not.toHaveTextContent('5s')
    // ...but the control is still labelled and shows its dot + icon.
    expect(link).toHaveAttribute('aria-label', 'Live telemetry status: Live')
    expect(link.querySelector('.bg-emerald-400')).not.toBeNull()
    expect(link.querySelector('svg')).not.toBeNull()
  })

  it('omits the inline freshness age when connected but lastMessageAt is null', () => {
    setState('connected', null)
    renderSegment()

    const link = getLink()
    expect(link).toHaveTextContent('Live')
    // No inline "· <age>" chip inside the link when there is no timestamp.
    expect(link).not.toHaveTextContent('·')
    // The tooltip still renders, with an em-dash for the missing age.
    expect(screen.getByRole('tooltip')).toHaveTextContent('Last message — ago')
  })

  it.each<[number, string]>([
    [0, '0s'],
    [5_000, '5s'],
    [59_000, '59s'],
    [60_000, '1m'],
    [90_000, '1m'],
    [3_540_000, '59m'],
    [3_600_000, '1h'],
    [7_200_000, '2h'],
  ])('formats a freshness age of %ims as "%s"', (offsetMs, label) => {
    setState('connected', agoIso(offsetMs))
    renderSegment()
    expect(getLink()).toHaveTextContent(label)
  })

  it('renders an em-dash for a future timestamp (clock skew)', () => {
    setState('connected', new Date(NOW + 60_000).toISOString())
    renderSegment()
    expect(getLink()).toHaveTextContent('—')
  })

  it('renders an em-dash for an unparseable timestamp', () => {
    setState('connected', 'not-a-real-date')
    renderSegment()
    expect(getLink()).toHaveTextContent('—')
  })

  it('surfaces the freshness age inside the tooltip body when connected', () => {
    setState('connected', agoIso(5_000))
    renderSegment()
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Live telemetry stream · Last message 5s ago',
    )
  })

  it('shows the short status (not a freshness age) in the tooltip body when not connected', () => {
    setState('disconnected')
    renderSegment()
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('Live telemetry stream · Offline')
    expect(tooltip).not.toHaveTextContent('Last message')
  })

  it('links to the signal explorer and is keyboard focusable with a visible focus ring', () => {
    setState('connected', agoIso(5_000))
    renderSegment()

    const link = getLink()
    expect(link).toHaveAttribute('href', '/signal-diff')
    expect(link.className).toContain('focus-visible:ring-1')

    link.focus()
    expect(link).toHaveFocus()

    // The anchor is a real link, so activating it does not throw.
    expect(() => fireEvent.click(link)).not.toThrow()
  })

  it('marks the status dot and icon as decorative so only the link name is announced', () => {
    setState('connected', agoIso(5_000))
    renderSegment()

    const link = getLink()
    const dot = link.querySelector('span[aria-hidden]')
    const icon = link.querySelector('svg')
    expect(dot).not.toBeNull()
    expect(dot).toHaveAttribute('aria-hidden')
    expect(icon).toHaveAttribute('aria-hidden')
  })

  it('falls back to the muted idle variant for an out-of-contract status instead of crashing', () => {
    // Simulate a future/contract-breaking value leaking out of the hook.
    mockState = {
      status: 'bogus' as unknown as LiveConnectionState['status'],
      lastMessageAt: null,
      channels: { sse: 'closed' },
    }

    expect(() => renderSegment()).not.toThrow()
    const link = getLink()
    expect(link).toHaveTextContent('Idle')
    expect(link.className).toContain('text-[var(--text-muted)]')
  })
})
