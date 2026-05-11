/**
 * AutopilotSection — unit-conversion + enum-decoding regression.
 *
 * Pre-fix (this commit):
 *   1. The component treated `vehicleState.speed` and `CruiseSetSpeed`
 *      observations as km/h (`value / 1.609344` then `toSpeedDisplay`).
 *      In reality both are normalized to SI m/s on ingestion (see
 *      internal/tesla/units/conversions.go — the `speedFields` map
 *      explicitly lists VehicleSpeed and CruiseSetSpeed as the two
 *      fields whose canonical SI form is m/s). Net effect under mph:
 *      ×1.39 instead of the correct ×2.237 — a ~38% under-display
 *      that turned a real 25 mph cruise set-point into "16 mph".
 *   2. Follow distance was read with `latestNumeric` even though Tesla
 *      emits CruiseFollowDistance as a proto enum (ValueKindEnum, e.g.
 *      "FollowDistance7"). Result: the field rendered "—" forever.
 *
 * Post-fix:
 *   - Both speeds go directly through `toSpeedDisplay` (m/s → display).
 *   - Follow distance is read via `latestText` with a numeric fallback,
 *     and the "FollowDistance" prefix is stripped so the user sees the
 *     bar count ("7") not the raw enum name.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/api/client', () => ({
  request: vi.fn(),
}))

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') return fallbackOrOpts
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>
          if (typeof o.defaultValue === 'string') return o.defaultValue
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

// AutopilotSection reads unit prefs via useUnits → useSettings. Stub
// the chain to a deterministic mph preference so the math is testable
// without round-tripping through the settings store.
vi.mock('@/hooks/useUnits', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useUnits')>('@/hooks/useUnits')
  return {
    ...actual,
    useUnits: () => ({
      unitPrefs: {
        distance: 'mi',
        speed: 'mph',
        temperature: '°F',
        pressure: 'psi',
        energy: 'kWh',
        duration: 'h',
        power: 'kW',
        locale: 'en-US',
        precision: 1,
      },
      formatDistance: (v: number) => String(v),
      formatSpeed: (v: number) => String(v),
      formatTemperature: (v: number) => String(v),
      formatPressure: (v: number) => String(v),
      formatEnergy: (v: number) => String(v),
      formatDuration: (v: number) => String(v),
      formatPower: (v: number) => String(v),
    }),
  }
})

import { request } from '@/api/client'
import AutopilotSection from '../AutopilotSection'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function renderWithClient(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
})

// AutopilotSection fans out three /api requests in fixed order:
//   1. /vehicles/:id/state  (useVehicleState)
//   2. /signals/observations?field=CruiseSetSpeed
//   3. /signals/observations?field=CruiseFollowDistance
// We stub them positionally; the order is stable as long as the
// hooks are declared in that order in the component.
function stubResponses(opts: {
  vehicleSpeedMps?: number | null
  cruiseSetSpeedMps?: number | null
  followDistanceEnum?: string | null
}) {
  // /vehicles/:id/state
  mockedRequest.mockResolvedValueOnce({
    state: opts.vehicleSpeedMps != null ? { speed: opts.vehicleSpeedMps } : {},
  })
  // CruiseSetSpeed observation
  mockedRequest.mockResolvedValueOnce({
    observations:
      opts.cruiseSetSpeedMps != null
        ? [
            {
              vehicle_id: 1,
              ts: 't0',
              field: 'CruiseSetSpeed',
              value_kind: 'ValueKindDouble',
              value: opts.cruiseSetSpeedMps,
            },
          ]
        : [],
  })
  // CruiseFollowDistance observation
  mockedRequest.mockResolvedValueOnce({
    observations:
      opts.followDistanceEnum != null
        ? [
            {
              vehicle_id: 1,
              ts: 't0',
              field: 'CruiseFollowDistance',
              value_kind: 'ValueKindEnum',
              value: opts.followDistanceEnum,
            },
          ]
        : [],
  })
}

// StatCard renders the label and value in two SIBLING divs inside a
// Card root. So `label.parentElement` is the label-row only — value
// lives one level up. statCardText() walks to the Card root.
function statCardText(labelEl: HTMLElement): string {
  return labelEl.parentElement?.parentElement?.textContent ?? ''
}

describe('AutopilotSection — SI m/s correctness', () => {
  it('renders Current Speed in mph from m/s without a /1.609 km/h step', async () => {
    // 26.8224 m/s = 60 mph exactly. Pre-fix: 26.8224 / 1.609 × 2.237 ≈ "37".
    stubResponses({ vehicleSpeedMps: 26.8224 })

    renderWithClient(<AutopilotSection vehicleId={1} />)
    const label = await screen.findByText('Current Speed')
    await waitFor(() => {
      expect(statCardText(label)).toContain('60')
    })
    expect(statCardText(label)).not.toContain('37')
  })

  it('renders Cruise Set Speed in mph from m/s without a /1.609 km/h step', async () => {
    // 11.176 m/s = 25 mph (a real value the local stack returns).
    stubResponses({ cruiseSetSpeedMps: 11.176 })

    renderWithClient(<AutopilotSection vehicleId={1} />)
    const label = await screen.findByText('Cruise Set Speed')
    await waitFor(() => {
      expect(statCardText(label)).toContain('25')
    })
    // Pre-fix would have rendered "16" (×1.39 instead of ×2.237).
    expect(statCardText(label)).not.toContain('16')
  })
})

describe('AutopilotSection — Follow Distance enum decoding', () => {
  it('strips the "FollowDistance" prefix from a ValueKindEnum value', async () => {
    // Tesla emits CruiseFollowDistance as e.g. "FollowDistance7".
    // The user wants to see the bar count ("7"), not the raw enum.
    stubResponses({
      vehicleSpeedMps: 0, // ensure the panel renders (hasAny)
      followDistanceEnum: 'FollowDistance7',
    })

    renderWithClient(<AutopilotSection vehicleId={1} />)
    const label = await screen.findByText('Follow Distance')
    await waitFor(() => {
      expect(statCardText(label)).toContain('7')
    })
    expect(statCardText(label)).not.toContain('FollowDistance')
  })

  it('renders em-dash when no follow-distance observations exist', async () => {
    stubResponses({ vehicleSpeedMps: 0, followDistanceEnum: null })

    renderWithClient(<AutopilotSection vehicleId={1} />)
    const label = await screen.findByText('Follow Distance')
    await waitFor(() => {
      expect(statCardText(label)).toContain('—')
    })
  })
})

describe('AutopilotSection — empty state', () => {
  it('renders the empty state when no signals are present anywhere', async () => {
    stubResponses({}) // all three sources empty

    renderWithClient(<AutopilotSection vehicleId={1} />)
    await waitFor(() => {
      expect(
        screen.getByText('No cruise / autopilot telemetry received yet'),
      ).toBeInTheDocument()
    })
    // Stat labels must NOT appear in the empty branch.
    expect(screen.queryByText('Current Speed')).toBeNull()
    expect(screen.queryByText('Cruise Set Speed')).toBeNull()
    expect(screen.queryByText('Follow Distance')).toBeNull()
  })
})
