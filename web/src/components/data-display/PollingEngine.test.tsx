/**
 * PollingEngine — behaviour, branch, null-safety and a11y coverage.
 *
 * Exercises every export of the module:
 *   - the pure helpers `formatDuration`, `formatTimeUntil`, `profileLabel`
 *     (all branches + the non-finite / invalid-date guards that used to render
 *     "NaNh NaNm"), and
 *   - the default `PollingEnginePanel` component across its feature-gate,
 *     savings, vehicle-list, empty and expand/collapse states.
 *
 * Network is faked by mocking `@/api/polling`; `AnimatedNumber` is stubbed to a
 * deterministic formatter so the eased counter does not race jsdom's rAF; and
 * `framer-motion` is reduced to a plain element so the infinite "pulse"
 * animation on active vehicles cannot leave an open handle.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'

import PollingEnginePanel, {
  formatDuration,
  formatTimeUntil,
  profileLabel,
} from './PollingEngine'
import { getPollingStatus, getPollingSavings } from '@/api/polling'
import type { CostSnapshot, VehiclePollingStatus } from '@/api/polling'

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/api/polling', () => ({
  getPollingStatus: vi.fn(),
  getPollingSavings: vi.fn(),
}))

// Deterministic i18n: return the English default, interpolating {{vars}} so the
// aria-label / labels read exactly as production would in the `en` locale.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) =>
      opts
        ? Object.entries(opts).reduce(
            (out, [k, v]) => out.replace(`{{${k}}}`, String(v)),
            fallback,
          )
        : fallback,
  }),
}))

// framer-motion `motion.div` → a plain div that forwards only DOM-safe
// attributes (className / style / aria-* / data-*), dropping the animation
// props so React does not warn and no infinite loop is scheduled.
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, style, ...rest }: Record<string, unknown> & { children?: ReactNode; className?: string; style?: Record<string, unknown> }) => {
      const domProps: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(rest)) {
        if (k.startsWith('aria-') || k.startsWith('data-') || k === 'role') {
          domProps[k] = v
        }
      }
      return (
        <div className={className} style={style} {...domProps}>
          {children}
        </div>
      )
    },
  },
  useReducedMotion: () => false,
}))

// Stub the eased counter with a synchronous formatter so numeric assertions are
// exact instead of racing the requestAnimationFrame tween.
vi.mock('./AnimatedNumber', () => ({
  AnimatedNumber: ({ value, decimals = 0 }: { value: number; decimals?: number }) => (
    <span data-testid="animated-number">{Number(value ?? 0).toFixed(decimals)}</span>
  ),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockedStatus = vi.mocked(getPollingStatus)
const mockedSavings = vi.mocked(getPollingSavings)

function makeVehicle(overrides: Partial<VehiclePollingStatus> = {}): VehiclePollingStatus {
  return {
    activity: 'moderate',
    profile: 'charging',
    consec_idle: 3,
    last_poll_time: '2026-01-01T00:00:00Z',
    next_poll_after: '2026-01-01T00:10:00Z',
    battery_level: 74,
    last_decision: {
      should_poll: false,
      next_interval_ms: 120000, // → "2m"
      activity: 1,
      profile: 'charging',
      reasons: ['battery stable', 'no recent motion'],
      cost_saved: 1,
      prediction: {
        next_state: 'sleeping',
        estimated_in: 300000 * 1e6, // 300000 ms → "5m"
        confidence: 0.9,
        based_on: 'weekly pattern',
      },
    },
    ...overrides,
  }
}

const fullSavings: CostSnapshot = {
  polls_made: 120,
  polls_saved: 380,
  savings_breakdown: {
    fleet_telemetry: 200,
    idle_detection: 100,
    prediction: 50,
    sleep_detection: 30,
  },
  savings_percent: 76,
  estimated_cost: 4,
  estimated_cost_without_engine: 16,
  estimated_savings: 12.5,
  monthly_credit: 20,
  remaining_credit: 8,
  projected_month_end: 6,
}

// Valid snapshot with a zero breakdown: SavingsCard still renders its stat
// cards, but the bar + legend (gated on total > 0) are omitted — which keeps
// the label "Prediction" out of the DOM so vehicle-prediction assertions stay
// unambiguous. Resolving `undefined` here would trip React Query's
// "data cannot be undefined" guard.
const zeroSavings: CostSnapshot = { ...fullSavings, savings_breakdown: {} }

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PollingEnginePanel />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockedStatus.mockReset()
  mockedSavings.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

// ── Pure helpers ──────────────────────────────────────────────────────────────

describe('formatDuration', () => {
  it('returns "now" for zero or negative durations', () => {
    expect(formatDuration(0)).toBe('now')
    expect(formatDuration(-1000)).toBe('now')
  })

  it('formats seconds, minutes and hours across the branch boundaries', () => {
    expect(formatDuration(5000)).toBe('5s')
    expect(formatDuration(59000)).toBe('59s')
    expect(formatDuration(60000)).toBe('1m')
    expect(formatDuration(90000)).toBe('1m')
    expect(formatDuration(3600000)).toBe('1h 0m')
    expect(formatDuration(3660000)).toBe('1h 1m')
  })

  it('renders a placeholder instead of "NaNh NaNm" for non-finite input', () => {
    expect(formatDuration(NaN)).toBe('—')
    expect(formatDuration(Infinity)).toBe('—')
    expect(formatDuration(-Infinity)).toBe('—')
  })
})

describe('formatTimeUntil', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  it('formats the remaining time to a future timestamp', () => {
    expect(formatTimeUntil('2026-01-01T00:00:30.000Z')).toBe('30s')
    expect(formatTimeUntil('2026-01-01T00:05:00.000Z')).toBe('5m')
    expect(formatTimeUntil('2026-01-01T02:30:00.000Z')).toBe('2h 30m')
  })

  it('returns "now" for a timestamp in the past', () => {
    expect(formatTimeUntil('2025-12-31T23:59:00.000Z')).toBe('now')
  })

  it('guards against an unparseable date instead of returning "NaNh NaNm"', () => {
    expect(formatTimeUntil('not-a-real-date')).toBe('—')
    expect(formatTimeUntil('')).toBe('—')
  })
})

describe('profileLabel', () => {
  it('maps known profiles to their human labels', () => {
    expect(profileLabel('driving')).toBe('Driving')
    expect(profileLabel('charging')).toBe('Charging')
    expect(profileLabel('idle')).toBe('Idle')
    expect(profileLabel('sleeping')).toBe('Sleeping')
  })

  it('falls back to the raw value for an unknown profile', () => {
    expect(profileLabel('hyperspace')).toBe('hyperspace')
  })
})

// ── PollingEnginePanel ────────────────────────────────────────────────────────

describe('PollingEnginePanel', () => {
  it('renders nothing while the engine is disabled', async () => {
    mockedStatus.mockResolvedValue({ enabled: false, vehicles: {} })
    mockedSavings.mockResolvedValue(fullSavings)

    const { container } = renderPanel()

    await waitFor(() => expect(mockedStatus).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Adaptive Polling Engine')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the header, active badge and the savings summary numbers', async () => {
    mockedStatus.mockResolvedValue({ enabled: true, vehicles: {} })
    mockedSavings.mockResolvedValue(fullSavings)

    renderPanel()

    expect(
      await screen.findByRole('heading', { name: /adaptive polling engine/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()

    // Summary labels + deterministic (mocked) AnimatedNumber values.
    expect(screen.getByText('Polls Saved')).toBeInTheDocument()
    expect(screen.getByText('76.0')).toBeInTheDocument() // savings_percent, 1 dp
    expect(screen.getByText('12.50')).toBeInTheDocument() // estimated_savings, 2 dp
    expect(screen.getByText('120')).toBeInTheDocument() // polls_made, 0 dp
    expect(screen.getByText('8.00')).toBeInTheDocument() // remaining_credit, 2 dp
  })

  it('shows an empty-state message when the engine is on but tracks no vehicles', async () => {
    mockedStatus.mockResolvedValue({ enabled: true, vehicles: {} })
    mockedSavings.mockResolvedValue(fullSavings)

    renderPanel()

    expect(await screen.findByText(/no vehicles tracked yet/i)).toBeInTheDocument()
    expect(screen.queryByText('Vehicle Activity')).not.toBeInTheDocument()
  })

  it('renders the savings breakdown bar + legend with proportional widths', async () => {
    mockedStatus.mockResolvedValue({ enabled: true, vehicles: {} })
    mockedSavings.mockResolvedValue(fullSavings)

    renderPanel()
    await screen.findByText('Adaptive Polling Engine')

    // Legend labels (rendered once because no vehicle prediction is present).
    expect(screen.getByText('Fleet Telemetry')).toBeInTheDocument()
    expect(screen.getByText('Idle Detection')).toBeInTheDocument()
    expect(screen.getByText('Prediction')).toBeInTheDocument()
    expect(screen.getByText('Sleep')).toBeInTheDocument()

    // Bar segments carry a "<label>: <value>" title and a proportional width.
    const fleet = screen.getByTitle('Fleet Telemetry: 200')
    expect(fleet).toHaveStyle({ width: `${(200 / 380) * 100}%` })
    expect(screen.getByTitle('Idle Detection: 100')).toBeInTheDocument()
  })

  it('hides the breakdown bar entirely when every saving is zero', async () => {
    mockedStatus.mockResolvedValue({ enabled: true, vehicles: {} })
    mockedSavings.mockResolvedValue({
      ...fullSavings,
      savings_breakdown: { fleet_telemetry: 0, idle_detection: 0, prediction: 0, sleep_detection: 0 },
    })

    renderPanel()
    await screen.findByText('Adaptive Polling Engine')

    // Stat cards still render, but the legend/bar (gated on total > 0) do not.
    expect(screen.getByText('Polls Saved')).toBeInTheDocument()
    expect(screen.queryByText('Fleet Telemetry')).not.toBeInTheDocument()
  })

  it('lists tracked vehicles with the activity chip and short VIN', async () => {
    mockedStatus.mockResolvedValue({
      enabled: true,
      vehicles: { ABCDEFGH12345678: makeVehicle({ activity: 'moderate', profile: 'charging' }) },
    })
    // No savings summary — keeps "Prediction" out of the DOM for this case.
    mockedSavings.mockResolvedValue(zeroSavings)

    renderPanel()

    expect(await screen.findByText('Vehicle Activity')).toBeInTheDocument()
    expect(screen.getByText('12345678')).toBeInTheDocument() // vin.slice(-8)
    // The activity chip uses the restored middle-dot separator (was mojibake).
    expect(screen.getByText('moderate · Charging')).toBeInTheDocument()
    expect(screen.getByText(/^next:/i)).toBeInTheDocument()
  })

  it('toggles the decision detail panel and exposes aria-expanded', async () => {
    mockedStatus.mockResolvedValue({
      enabled: true,
      vehicles: { ABCDEFGH12345678: makeVehicle({ activity: 'idle', profile: 'idle' }) },
    })
    mockedSavings.mockResolvedValue(zeroSavings)

    renderPanel()

    const toggle = await screen.findByRole('button', {
      name: /toggle polling details for 12345678/i,
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/consecutive idle/i)).not.toBeInTheDocument()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Interval: 2m')).toBeInTheDocument()
    expect(screen.getByText('Consecutive idle: 3')).toBeInTheDocument()
    expect(screen.getByText('Battery: 74%')).toBeInTheDocument()
    expect(screen.getByText('battery stable')).toBeInTheDocument()
    expect(screen.getByText('no recent motion')).toBeInTheDocument()
    // Prediction row (formerly a corrupted emoji) renders real content.
    expect(screen.getByText(/prediction: sleeping/i)).toBeInTheDocument()
    expect(screen.getByText(/based on: weekly pattern/i)).toBeInTheDocument()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('battery stable')).not.toBeInTheDocument()
  })

  it('survives a decision with missing reasons / prediction without crashing', async () => {
    mockedStatus.mockResolvedValue({
      enabled: true,
      vehicles: {
        ABCDEFGH12345678: makeVehicle({
          consec_idle: undefined as unknown as number,
          battery_level: undefined as unknown as number,
          last_decision: {
            should_poll: true,
            next_interval_ms: undefined as unknown as number,
            activity: 0,
            profile: 'idle',
            reasons: undefined as unknown as string[],
            cost_saved: 0,
            prediction: null,
          },
        }),
      },
    })
    mockedSavings.mockResolvedValue(zeroSavings)

    renderPanel()

    const toggle = await screen.findByRole('button', {
      name: /toggle polling details for 12345678/i,
    })
    fireEvent.click(toggle)

    // Null-safe fallbacks: consec_idle/battery → 0, next_interval_ms → "now".
    expect(screen.getByText('Consecutive idle: 0')).toBeInTheDocument()
    expect(screen.getByText('Battery: 0%')).toBeInTheDocument()
    expect(screen.getByText('Interval: now')).toBeInTheDocument()
    // No prediction row for a null prediction.
    expect(screen.queryByText(/^prediction:/i)).not.toBeInTheDocument()
  })
})

