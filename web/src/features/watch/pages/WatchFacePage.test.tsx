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
  summary: { data: undefined as unknown, isLoading: false, error: null as unknown },
  command: { mutate: vi.fn(), isPending: false },
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
    range_km: 300,
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

beforeEach(() => {
  hooks.summary = { data: undefined, isLoading: false, error: null }
  hooks.command = { mutate: vi.fn(), isPending: false }
  hooks.unitPrefs = { distance: 'km', temperature: '°C' }
})

afterEach(() => {
  cleanup()
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
        range_km: 300,
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
    expect(screen.getByRole('button', { name: 'Sentry mode off' })).toBeInTheDocument()
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
      data: makeSummary({ range_km: 300, inside_temp_c: 20, is_climate_on: false }),
      isLoading: false,
      error: null,
    }
    renderPage()

    // 300 km → 300000 m → ÷1609.344 ≈ 186 mi
    expect(screen.getByText('186 mi')).toBeInTheDocument()
    // 20 °C → 68 °F, shown as the climate control's visible label.
    expect(screen.getByText('68°')).toBeInTheDocument()
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
    // degraded backend could omit). The ?? 0 guards must keep the UI clean.
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

    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.getByText('0 km')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('NaN')
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
    expect(arcs[1]).toHaveAttribute('stroke', '#22c55e')
    expect(arcs[1]).toHaveAttribute('stroke-dasharray', `${72 * 2.64} 264`)
  })

  it('uses the red arc for a critically low level', () => {
    const { container } = render(
      <BatteryGauge level={10} rangeDisplay={0} distanceUnit="mi" />,
    )
    const arcs = container.querySelectorAll('circle')
    expect(arcs[1]).toHaveAttribute('stroke', '#ef4444')
    expect(arcs[1]).toHaveAttribute('stroke-dasharray', `${10 * 2.64} 264`)
    expect(screen.getByText('0 mi')).toBeInTheDocument()
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

    const btn = screen.getByRole('button', { name: 'Turn climate off' })
    expect(btn).toHaveTextContent('21°')
    expect(btn.className).toContain('text-emerald-400')
    expect(screen.getByText('21°')).toHaveAttribute('aria-hidden', 'true')
  })

  it('falls back to the visible label as the accessible name when no ariaLabel is given', () => {
    render(<StatusIcon icon={Thermometer} active={false} label="21°" />)
    expect(screen.getByRole('button', { name: '21°' })).toBeInTheDocument()
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
    expect(getBatteryColor(100)).toBe('#22c55e')
    expect(getBatteryColor(41)).toBe('#22c55e')
    // Boundary: 40 is NOT > 40, so it falls into the amber band.
    expect(getBatteryColor(40)).toBe('#f59e0b')
    expect(getBatteryColor(21)).toBe('#f59e0b')
    // Boundary: 20 is NOT > 20, so it falls into the red band.
    expect(getBatteryColor(20)).toBe('#ef4444')
    expect(getBatteryColor(0)).toBe('#ef4444')
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
    expect(watchStateClassName('driving')).toContain('text-blue-400')
    expect(watchStateClassName('charging')).toContain('text-emerald-400')
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
})
