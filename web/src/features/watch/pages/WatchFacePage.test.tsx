/**
 * WatchFacePage — behaviour + hardening tests.
 *
 * WatchFacePage is the chrome-less wearable surface (Apple Watch / Wear OS PWA).
 * It orchestrates the watch-summary query, renders a battery gauge + status
 * chips + tap commands, and appends the opt-in Helix narrator as a sibling that
 * MUST stay hidden while AI is off. These tests drive the page end-to-end plus
 * unit-test every export it surfaces:
 *
 *   - WatchFacePage: loading / error / empty / populated states, command
 *     wiring (correct action + vehicle_id from the URL), unit conversion at the
 *     display boundary (km/°C vs mi/°F), the charging countdown branch, pending
 *     disablement, and the wearable "no AI chrome when off" invariant.
 *   - BatteryGauge: %/range render, colour thresholds, arc geometry.
 *   - StatusIcon: accessible name for icon-only controls (the a11y bug fix),
 *     onClick, loading disablement, decorative-label hiding, label fallback.
 *   - WatchPWAMeta: PWA meta/link injection + cleanup on unmount.
 *   - getBatteryColor / watchStateVariant / watchStateClassName /
 *     formatRelativeTime: full branch coverage incl. the invalid-timestamp fix.
 *
 * Data hooks are mocked at the `@/api/hooks/useWatch` boundary and units at
 * `@/hooks/useUnits`; `react-i18next` is stubbed to echo the inline fallback
 * (with {{var}} interpolation). `useSettings` (which gates the AI sibling to
 * off) comes from the global stub in src/test-setup.ts. No real network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { Shield, Thermometer } from 'lucide-react'
import { gaugeTone, severityTokens } from '@/lib/tokens'
import { getGlobalLocale, getGlobalPrecision, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat'

// framer-motion's useReducedMotion (via <Spinner>) probes matchMedia, which
// jsdom omits. Provide an inert stub so the loading branch renders cleanly.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

const hooks = vi.hoisted(() => ({
  summary: { data: undefined, isLoading: false, error: null } as {
    data: unknown
    isLoading: boolean
    error: unknown
    refetch?: () => unknown
    availability?: 'configured' | 'not-configured' | 'prerequisite-error'
    recheckAvailability?: () => void
    fetchStatus?: 'idle' | 'paused' | 'fetching'
  },
  command: { mutate: vi.fn(), isPending: false },
  operational: {
    mode: 'live' as 'live' | 'cached' | 'as_of',
    label: 'Live',
    description: 'Live vehicle data',
    canWrite: true,
    isReadOnly: false,
    writeBlockReason: null as string | null,
  },
  unitPrefs: { distance: 'km', temperature: '°C' } as {
    distance: 'km' | 'mi' | 'ft'
    temperature: '°C' | '°F'
  },
}))

vi.mock('@/api/hooks/useWatch', () => ({
  useWatchSummary: () => hooks.summary,
  useWatchCommand: () => hooks.command,
}))

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: hooks.unitPrefs }),
}))

vi.mock('@/hooks/useOperationalMode', () => ({
  useOperationalMode: () => hooks.operational,
}))

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: Record<string, unknown>) => {
        let out = typeof fallback === 'string' ? fallback : key
        if (opts && typeof opts === 'object') {
          for (const [k, v] of Object.entries(opts)) {
            out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v))
          }
        }
        return out
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

import WatchFacePage, {
  BatteryGauge,
  StatusIcon,
  WatchPWAMeta,
  getBatteryColor,
  watchStateVariant,
  watchStateClassName,
  formatRelativeTime,
} from './WatchFacePage'
import type { WatchSummary } from '@/api/hooks/useWatch'

function makeSummary(overrides: Partial<WatchSummary> = {}): WatchSummary {
  return {
    vehicle_name: 'My Model 3',
    state: 'online',
    battery_level: 72,
    range_m: 300000,
    is_charging: false,
    charge_rate: 0,
    time_to_full: 0,
    is_locked: true,
    sentry_mode: false,
    inside_temp_c: 21,
    outside_temp_c: 15,
    is_climate_on: false,
    last_updated: new Date().toISOString(),
    ...overrides,
  }
}

function renderPage(route = '/watch') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <WatchFacePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

let previousLocale: string
let previousPrecision: number

beforeEach(() => {
  previousLocale = getGlobalLocale()
  previousPrecision = getGlobalPrecision()
  setGlobalLocale('en-US')
  hooks.summary = { data: undefined, isLoading: false, error: null }
  hooks.command = { mutate: vi.fn(), isPending: false }
  hooks.unitPrefs = { distance: 'km', temperature: '°C' }
  hooks.operational = {
    mode: 'live', label: 'Live', description: 'Live vehicle data',
    canWrite: true, isReadOnly: false, writeBlockReason: null,
  }
})

afterEach(() => {
  cleanup()
  setGlobalLocale(previousLocale)
  setGlobalPrecision(previousPrecision)
})

describe('WatchFacePage', () => {
  it('shows the watch-shaped loading skeleton while the summary query is in flight', () => {
    hooks.summary = { data: undefined, isLoading: true, error: null }
    renderPage()

    const status = screen.getByRole('status')
    expect(status).toBeInTheDocument()
    expect(status).toHaveAttribute('aria-label', 'Loading watch summary…')
    expect(status).toHaveAttribute('aria-busy', 'true')
    // Neither the empty message nor any vehicle content is shown yet.
    expect(screen.queryByText('No vehicle found')).toBeNull()
    expect(screen.queryByText('My Model 3')).toBeNull()
  })

  it('renders the error text when the summary query fails, without a blank panel', () => {
    hooks.summary = { data: undefined, isLoading: false, error: new Error('boom') }
    renderPage()

    expect(screen.getByText('Error: boom')).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText('No vehicle found')).toBeNull()
  })

  it('renders an explicit empty state (not a blank panel) when there is no data and no error', () => {
    hooks.summary = { data: undefined, isLoading: false, error: null }
    renderPage()

    expect(screen.getByText('No vehicle found')).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders the populated watch face (km/°C) with battery, range, state, and accessible controls', () => {
    hooks.summary = {
      data: makeSummary({
        vehicle_name: 'My Model 3',
        battery_level: 72,
        range_m: 300000,
        state: 'online',
        is_locked: true,
        is_climate_on: false,
        sentry_mode: false,
        inside_temp_c: 21,
      }),
      isLoading: false,
      error: null,
    }
    renderPage()

    expect(screen.getByText('My Model 3')).toBeInTheDocument()
    expect(screen.getByText('72%')).toBeInTheDocument()
    expect(screen.getByText('300 km')).toBeInTheDocument()
    expect(screen.getByText('online')).toBeInTheDocument()

    // Icon-only lock control now carries a descriptive accessible name (bug fix).
    expect(screen.getByRole('button', { name: 'Unlock vehicle' })).toBeInTheDocument()
    const climate = screen.getByRole('button', { name: 'Turn climate on' })
    expect(climate).toHaveTextContent('21°')
    expect(screen.getByRole('img', { name: 'Sentry mode off' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sentry mode off' })).not.toBeInTheDocument()
  })

  it.each([false, true])('distinguishes a paused initial request from an empty response (loading=%s)', (isLoading) => {
    hooks.summary = { data: undefined, isLoading, error: null, fetchStatus: 'paused' }
    renderPage()

    expect(screen.getByRole('status')).toHaveTextContent('Refresh paused')
    expect(screen.queryByText('No vehicle found')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Loading watch summary…')).not.toBeInTheDocument()
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Cached')).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /Battery/ })).not.toBeInTheDocument()
    expect(hooks.command.mutate).not.toHaveBeenCalled()
  })

  it.each(['cached', 'as_of'] as const)('explains %s mode without claiming an empty vehicle result', (mode) => {
    hooks.operational = {
      mode, label: mode === 'cached' ? 'Cached' : 'As of',
      description: mode === 'cached' ? 'Cached vehicle data' : 'Historical vehicle data',
      canWrite: false, isReadOnly: true, writeBlockReason: 'Live mode is required',
    }
    renderPage()

    expect(screen.getByRole('status', { name: hooks.operational.description })).toBeInTheDocument()
    expect(screen.getByText(hooks.operational.description)).toBeInTheDocument()
    expect(screen.queryByText('No vehicle found')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unlock vehicle' })).not.toBeInTheDocument()
    expect(hooks.command.mutate).not.toHaveBeenCalled()
  })

  it('preserves initial fatal errors and recovery even when the request is paused', () => {
    const refetch = vi.fn()
    hooks.summary = {
      data: undefined, isLoading: false, error: new Error('watch unavailable'),
      fetchStatus: 'paused', refetch,
    }
    renderPage()

    expect(screen.getByText('Error: watch unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(hooks.command.mutate).not.toHaveBeenCalled()
  })

  it.each(['not-configured', 'prerequisite-error'] as const)('preserves %s access recovery before paused no-data presentation', (availability) => {
    const recheckAvailability = vi.fn()
    hooks.summary = {
      data: undefined, isLoading: false, error: null, fetchStatus: 'paused',
      availability, recheckAvailability,
    }
    renderPage()

    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument()
    expect(screen.queryByText('No vehicle found')).not.toBeInTheDocument()
    if (availability === 'not-configured') {
      expect(screen.getByRole('link', { name: 'Manage API keys' })).toHaveAttribute('href', '/api-keys')
    } else {
      expect(screen.getByText('Watch access could not be checked')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      expect(recheckAvailability).toHaveBeenCalledTimes(1)
    }
    expect(hooks.command.mutate).not.toHaveBeenCalled()
  })

  it('dispatches the correct commands with the vehicle_id parsed from the URL', () => {
    hooks.summary = {
      data: makeSummary({ is_locked: true, is_climate_on: false }),
      isLoading: false,
      error: null,
    }
    renderPage('/watch?vehicle_id=7')

    fireEvent.click(screen.getByRole('button', { name: 'Unlock vehicle' }))
    expect(hooks.command.mutate).toHaveBeenCalledWith({ vehicleId: 7, command: 'unlock' })

    fireEvent.click(screen.getByRole('button', { name: 'Turn climate on' }))
    expect(hooks.command.mutate).toHaveBeenCalledWith({ vehicleId: 7, command: 'climate_on' })
    expect(hooks.command.mutate).toHaveBeenCalledTimes(2)
  })

  it('shows the charging countdown only while charging (with interpolated minutes)', () => {
    hooks.summary = {
      data: makeSummary({ is_charging: true, time_to_full: 45 }),
      isLoading: false,
      error: null,
    }
    const { unmount } = renderPage()
    expect(screen.getByText('45m to full')).toBeInTheDocument()
    unmount()

    hooks.summary = {
      data: makeSummary({ is_charging: false, time_to_full: 45 }),
      isLoading: false,
      error: null,
    }
    renderPage()
    expect(screen.queryByText(/to full/)).toBeNull()
  })

  it('converts range to miles and inside temp to °F at the display boundary', () => {
    hooks.unitPrefs = { distance: 'mi', temperature: '°F' }
    hooks.summary = {
      data: makeSummary({ range_m: 300000, inside_temp_c: 20, is_climate_on: false }),
      isLoading: false,
      error: null,
    }
    renderPage()

    // 300000 m → ÷1609.344 ≈ 186 mi
    expect(screen.getByText('186 mi')).toBeInTheDocument()
    // 20 °C → 68 °F, shown as the climate control's visible label.
    expect(screen.getByText('68°')).toBeInTheDocument()
  })

  it('uses locale-aware whole-number labels without changing SI data or raw gauge thresholds', () => {
    setGlobalLocale('de-DE')
    setGlobalPrecision(3)
    hooks.unitPrefs = { distance: 'mi', temperature: '°F' }
    const summary = Object.freeze(makeSummary({
      battery_level: 40.4, range_m: 1986690.816, inside_temp_c: 20.4,
      is_charging: true, time_to_full: 1234.4,
    }))
    hooks.summary = { data: summary, isLoading: false, error: null }
    const { container } = renderPage()

    expect(screen.getByRole('img', { name: 'Battery 40%; range 1.234 mi' })).toBeInTheDocument()
    expect(screen.getByText('69°')).toBeInTheDocument()
    expect(screen.getByText('1.234m to full')).toBeInTheDocument()
    const arc = container.querySelectorAll('circle')[1]
    expect(arc).toHaveAttribute('stroke', gaugeTone.success)
    expect(Number(arc.getAttribute('stroke-dashoffset'))).toBeCloseTo(2 * Math.PI * 59 * 0.596)
    expect(summary.range_m).toBe(1986690.816)
    expect(summary.inside_temp_c).toBe(20.4)
    expect(summary.battery_level).toBe(40.4)
    expect(summary.time_to_full).toBe(1234.4)
  })

  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY])(
    'keeps invalid readings (%s) unknown rather than formatting them as zero',
    (value) => {
      hooks.summary = {
        data: { ...makeSummary({ is_charging: true }), battery_level: value, range_m: value,
          inside_temp_c: value, time_to_full: value },
        isLoading: false, error: null,
      }
      renderPage()
      expect(screen.getByRole('img', { name: 'Battery Unknown; range —' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Turn climate on' })).toHaveTextContent('—')
      expect(screen.getByText('Time to full unknown')).toBeInTheDocument()
      expect(screen.queryByText('0%')).not.toBeInTheDocument()
      expect(screen.queryByText('0 km')).not.toBeInTheDocument()
    },
  )

  it('formats measured zero readings without treating them as missing', () => {
    hooks.summary = {
      data: makeSummary({ battery_level: 0, range_m: 0, inside_temp_c: 0,
        is_charging: true, time_to_full: 0 }),
      isLoading: false, error: null,
    }
    renderPage()
    expect(screen.getByRole('img', { name: 'Battery 0%; range 0 km' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn climate on' })).toHaveTextContent('0°')
    expect(screen.getByText('0m to full')).toBeInTheDocument()
  })

  it('disables the tap controls while a command is pending', () => {
    hooks.command = { mutate: vi.fn(), isPending: true }
    hooks.summary = {
      data: makeSummary({ is_locked: false, is_climate_on: true }),
      isLoading: false,
      error: null,
    }
    renderPage()

    expect(screen.getByRole('button', { name: 'Lock vehicle' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Turn climate off' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Lock vehicle' })).toHaveAttribute('aria-busy', 'true')
  })

  it.each([
    ['km', 1609.344, '2 km'],
    ['mi', 1609.344, '1 mi'],
    ['km', 0, '0 km'],
    ['mi', 0, '0 mi'],
  ] as const)('displays canonical %s range from %s meters as %s', (distance, range_m, expected) => {
    hooks.unitPrefs = { distance, temperature: '°C' }
    hooks.summary = { data: makeSummary({ range_m }), isLoading: false, error: null }
    renderPage()
    expect(screen.getByText(expected)).toBeInTheDocument()
  })

  it('keeps the wearable surface chrome-less: the opt-in Helix panel stays hidden when AI is off', () => {
    hooks.summary = { data: makeSummary(), isLoading: false, error: null }
    renderPage()

    expect(
      screen.queryByTestId('ai-feature-watch-face-nl-response-root'),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: /Ask about my car/i })).toBeNull()
    // The deterministic wearable shell is still present.
    expect(screen.getByText('72%')).toBeInTheDocument()
  })

  it('is null-safe: renders "NaN"-free output when numeric fields are missing', () => {
    // Simulate a partial payload (fields the Go contract types as present but a
    // degraded backend could omit). Unknown readings must not imply real zero.
    hooks.summary = {
      data: {
        vehicle_name: 'Partial Car',
        state: 'online',
        is_charging: false,
        is_locked: true,
        sentry_mode: false,
        is_climate_on: false,
        last_updated: '',
      } as unknown as WatchSummary,
      isLoading: false,
      error: null,
    }
    renderPage()

    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    expect(screen.queryByText('0 km')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Battery Unknown; range —' })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('NaN')
  })

  it('keeps summary, gauge and controls during a failed refresh and dispatches only the selected vehicle command', () => {
    hooks.summary = { data: makeSummary(), isLoading: false, error: new Error('refresh failed') }
    renderPage('/watch?vehicle_id=9')
    expect(screen.getByText('Cached')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Battery 72%; range 300 km' })).toBeInTheDocument()
    expect(screen.getByText('My Model 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Unlock vehicle' }))
    expect(hooks.command.mutate).toHaveBeenCalledWith({ vehicleId: 9, command: 'unlock' })
  })

  it('retains read-only status and command disablement without replacing the wearable face', () => {
    hooks.operational = {
      mode: 'cached', label: 'Cached', description: 'Cached vehicle data',
      canWrite: false, isReadOnly: true, writeBlockReason: 'Live mode is required',
    }
    hooks.summary = { data: makeSummary(), isLoading: false, error: null }
    renderPage('/watch?vehicle_id=7')
    expect(screen.getByText('72%')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Cached vehicle data' })).toBeInTheDocument()
    const unlock = screen.getByRole('button', { name: 'Unlock vehicle' })
    expect(unlock).toBeDisabled()
    expect(unlock).toHaveAttribute('title', 'Live mode is required')
    fireEvent.click(unlock)
    fireEvent.click(screen.getByRole('button', { name: 'Turn climate on' }))
    expect(hooks.command.mutate).not.toHaveBeenCalled()
  })

  it('offers read-only summary recovery after initial failure without sending any vehicle command', () => {
    const refetch = vi.fn()
    hooks.summary = { data: undefined, isLoading: false, error: new Error('watch unavailable'), refetch }
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(hooks.command.mutate).not.toHaveBeenCalled()
  })

  it('distinguishes missing charging time from a measured zero without changing measured rounding', () => {
    hooks.summary = {
      data: { ...makeSummary({ is_charging: true }), time_to_full: null },
      isLoading: false, error: null,
    }
    const { unmount } = renderPage()
    expect(screen.getByText('Time to full unknown')).toBeInTheDocument()
    expect(screen.queryByText('0m to full')).not.toBeInTheDocument()
    unmount()
    hooks.summary = { data: makeSummary({ is_charging: true, time_to_full: 0 }), isLoading: false, error: null }
    renderPage()
    expect(screen.getByText('0m to full')).toBeInTheDocument()
  })

  it('offers configuration rather than inventing an empty vehicle when watch access is absent', () => {
    hooks.summary = { data: undefined, isLoading: false, error: null, availability: 'not-configured' }
    renderPage()
    expect(screen.getByText('Watch access is not configured')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manage API keys' })).toHaveAttribute('href', '/api-keys')
    expect(screen.queryByText('No vehicle found')).not.toBeInTheDocument()
    expect(hooks.command.mutate).not.toHaveBeenCalled()
  })

  it('retains the face and disables commands while prerequisite recovery rechecks access', () => {
    const recheckAvailability = vi.fn()
    hooks.summary = {
      data: makeSummary(), isLoading: false, error: null,
      availability: 'prerequisite-error', recheckAvailability,
    }
    renderPage()
    expect(screen.getByText('Watch access could not be checked')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Battery 72%; range 300 km' })).toBeInTheDocument()
    const unlock = screen.getByRole('button', { name: 'Unlock vehicle' })
    expect(unlock).toBeDisabled()
    expect(unlock).toHaveAccessibleDescription('Watch access could not be checked')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(recheckAvailability).toHaveBeenCalledTimes(1)
    expect(hooks.command.mutate).not.toHaveBeenCalled()
  })

  it('exposes retained refresh recovery without replacing the face or issuing a command', () => {
    const refetch = vi.fn()
    hooks.summary = { data: makeSummary(), isLoading: false, error: new Error('refresh failed'), refetch }
    renderPage()
    expect(screen.getByText('72%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(hooks.command.mutate).not.toHaveBeenCalled()
  })

  it('keeps paused readings and a named scrollable main without claiming a fresh result', () => {
    hooks.summary = { data: makeSummary(), isLoading: false, error: null, fetchStatus: 'paused' }
    renderPage()
    expect(screen.getByText('Cached')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Watch face' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveClass('overflow-y-auto')
    expect(screen.getByRole('img', { name: 'Battery 72%; range 300 km' })).toBeInTheDocument()
    expect(document.title).toBe('Watch face — TeslaSync')
  })
})

describe('BatteryGauge', () => {
  it('renders the level, range, a green arc, and correct arc geometry for a healthy level', () => {
    const { container } = render(
      <BatteryGauge level={72} rangeDisplay={300} distanceUnit="km" />,
    )

    expect(screen.getByText('72%')).toBeInTheDocument()
    expect(screen.getByText('300 km')).toBeInTheDocument()

    const arcs = container.querySelectorAll('circle')
    expect(arcs).toHaveLength(2)
    expect(arcs[1]).toHaveAttribute('stroke', gaugeTone.success)
    const circumference = 2 * Math.PI * 59
    expect(Number(arcs[1].getAttribute('stroke-dasharray'))).toBeCloseTo(circumference)
    expect(Number(arcs[1].getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference * 0.28)
    expect(screen.getByRole('img', { name: 'Battery 72%; range 300 km' })).toBeInTheDocument()
  })

  it('uses the red arc for a critically low level', () => {
    const { container } = render(
      <BatteryGauge level={10} rangeDisplay={0} distanceUnit="mi" />,
    )
    const arcs = container.querySelectorAll('circle')
    expect(arcs[1]).toHaveAttribute('stroke', gaugeTone.danger)
    expect(Number(arcs[1].getAttribute('stroke-dashoffset'))).toBeCloseTo(2 * Math.PI * 59 * 0.9)
    expect(screen.getByText('0 mi')).toBeInTheDocument()
  })

  it('distinguishes unknown charge and range from a measured zero', () => {
    const { rerender } = render(<BatteryGauge level={null} rangeDisplay={null} distanceUnit="km" />)
    expect(screen.getByRole('img', { name: 'Battery Unknown; range —' })).toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    rerender(<BatteryGauge level={0} rangeDisplay={0} distanceUnit="km" />)
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.getByText('0 km')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Battery 0%; range 0 km' })).toBeInTheDocument()
  })
})

describe('StatusIcon', () => {
  it('exposes an accessible name for an icon-only control and fires onClick', () => {
    const onClick = vi.fn()
    render(<StatusIcon icon={Shield} active={false} ariaLabel="Sentry mode off" onClick={onClick} />)

    const btn = screen.getByRole('button', { name: 'Sentry mode off' })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('is disabled and non-interactive while loading', () => {
    const onClick = vi.fn()
    render(<StatusIcon icon={Shield} active ariaLabel="Lock vehicle" onClick={onClick} loading />)

    const btn = screen.getByRole('button', { name: 'Lock vehicle' })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('shows a visible label, applies the active colour, and hides the label from assistive tech', () => {
    render(
      <StatusIcon icon={Thermometer} active color="emerald" label="21°" ariaLabel="Turn climate off" />,
    )

    const btn = screen.getByRole('img', { name: 'Turn climate off' })
    expect(btn).toHaveTextContent('21°')
    expect(btn.className).toContain(severityTokens.success.fg)
    expect(screen.getByText('21°')).toHaveAttribute('aria-hidden', 'true')
  })

  it('falls back to the visible label as the accessible name when no ariaLabel is given', () => {
    render(<StatusIcon icon={Thermometer} active={false} label="21°" />)
    expect(screen.getByRole('img', { name: '21°' })).toBeInTheDocument()
  })
})

describe('WatchPWAMeta', () => {
  it('injects PWA meta/link tags and restores the head on unmount', () => {
    expect(document.querySelector('meta[name="theme-color"]')).toBeNull()
    expect(document.querySelector('link[rel="manifest"]')).toBeNull()

    const { unmount } = render(<WatchPWAMeta />)

    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      '#000000',
    )
    expect(
      document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute('content'),
    ).toBe('yes')
    expect(
      document
        .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
        ?.getAttribute('content'),
    ).toBe('black')
    expect(document.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe(
      '/watch-manifest.json',
    )

    unmount()

    expect(document.querySelector('meta[name="theme-color"]')).toBeNull()
    expect(document.querySelector('link[rel="manifest"]')).toBeNull()
  })
})

describe('getBatteryColor', () => {
  it('maps battery level to the correct threshold colour', () => {
    expect(getBatteryColor(100)).toBe(gaugeTone.success)
    expect(getBatteryColor(41)).toBe(gaugeTone.success)
    // Boundary: 40 is NOT > 40, so it falls into the amber band.
    expect(getBatteryColor(40)).toBe(gaugeTone.warning)
    expect(getBatteryColor(21)).toBe(gaugeTone.warning)
    // Boundary: 20 is NOT > 20, so it falls into the red band.
    expect(getBatteryColor(20)).toBe(gaugeTone.danger)
    expect(getBatteryColor(0)).toBe(gaugeTone.danger)
  })
})

describe('watchStateVariant', () => {
  it('maps vehicle state to the badge variant, defaulting unknown states to neutral', () => {
    expect(watchStateVariant('driving')).toBe('info')
    expect(watchStateVariant('charging')).toBe('success')
    expect(watchStateVariant('online')).toBe('neutral')
    expect(watchStateVariant('asleep')).toBe('neutral')
    expect(watchStateVariant('')).toBe('neutral')
  })
})

describe('watchStateClassName', () => {
  it('returns state-specific classes and an empty string for unknown states', () => {
    expect(watchStateClassName('driving')).toContain(severityTokens.info.fg)
    expect(watchStateClassName('charging')).toContain(severityTokens.success.fg)
    expect(watchStateClassName('asleep')).toContain('text-[var(--text-muted)]')
    expect(watchStateClassName('online')).toContain('text-[var(--text-secondary)]')
    expect(watchStateClassName('offline')).toBe('')
  })
})

describe('formatRelativeTime', () => {
  it('returns an empty string for empty or invalid timestamps', () => {
    expect(formatRelativeTime('')).toBe('')
    // Invalid date must not produce "NaNd ago" (the hardening fix).
    expect(formatRelativeTime('not-a-date')).toBe('')
  })

  it('formats recent timestamps with the coarsest sensible unit', () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
    expect(formatRelativeTime(new Date().toISOString())).toBe('just now')
    expect(formatRelativeTime(ago(5 * 60 * 1000))).toBe('5m ago')
    expect(formatRelativeTime(ago(3 * 60 * 60 * 1000))).toBe('3h ago')
    expect(formatRelativeTime(ago(2 * 24 * 60 * 60 * 1000))).toBe('2d ago')
  })

  it('localizes the existing relative-time buckets without changing their counts', () => {
    const translate = vi.fn((key: string, _fallback: string, count?: number) => `${key}:${count ?? ''}`)
    expect(formatRelativeTime(new Date().toISOString(), translate)).toBe('watch.updated.justNow:')
    expect(formatRelativeTime(new Date(Date.now() - 5 * 60_000).toISOString(), translate))
      .toBe('watch.updated.minutesAgo:5')
    expect(formatRelativeTime(new Date(Date.now() - 3 * 3600_000).toISOString(), translate))
      .toBe('watch.updated.hoursAgo:3')
    expect(formatRelativeTime(new Date(Date.now() - 2 * 86400_000).toISOString(), translate))
      .toBe('watch.updated.daysAgo:2')
    translate.mockClear()
    expect(formatRelativeTime('not-a-date', translate)).toBe('')
    expect(translate).not.toHaveBeenCalled()
  })
})
