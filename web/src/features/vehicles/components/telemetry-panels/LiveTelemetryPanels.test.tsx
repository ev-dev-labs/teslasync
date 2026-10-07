/**
 * LiveTelemetryPanels — orchestration, wiring, null-safety + a11y coverage.
 *
 * LiveTelemetryPanels is a pure composition/orchestrator: it renders a "Live
 * Telemetry" section header plus seven presentational panels and fans its ten
 * props out to the correct child. There is no data fetching and no internal
 * conditional rendering, so the surface under test is the orchestrator's OWN
 * behaviour:
 *
 *   1. Header + a11y → the <h2> renders through the i18n fallback and the
 *      decorative "live" pulse is hidden from assistive tech (aria-hidden).
 *   2. Completeness → all seven panels mount unconditionally (no gutted /
 *      hidden sections when a source is absent).
 *   3. Wiring → each panel receives exactly its own data source, by reference,
 *      and the sseConnected / remoteStartEnabled flags reach the right panels.
 *   4. Null pass-through → nullish snapshots flow straight through (never
 *      coerced) so each panel can render its own empty state.
 *   5. Null-safety → a nullish `live` map is coalesced to a single stable
 *      empty object so VehicleStatePanel (which reads keys off it) never throws
 *      and no fresh literal is allocated per render.
 *
 * Strategy (mirrors web/src/features/vehicles/pages/VehicleDetailPage.test.tsx):
 *   - The seven child panels are stubbed so orchestration assertions capture
 *     the exact props the component computed; the real <FadeIn> (framer-motion)
 *     renders for real (matchMedia is polyfilled below).
 *   - react-i18next resolves the developer fallback string.
 *   - user-event is intentionally NOT a dependency of this codebase (see
 *     web/package.json) — this component has no interactive controls anyway.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type {
  MotorSnapshot,
  ClimateSnapshot,
  SecurityEvent,
  TirePressureSnapshot,
  ChargingTelemetry,
  MediaSnapshot,
  LocationSnapshot,
} from '@/api/types'

// jsdom lacks matchMedia; framer-motion (<FadeIn> → useReducedMotion) reads it
// at render. Install a no-op before any import runs.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false
      },
    })) as unknown as typeof window.matchMedia
  }
})

// Shared, hoisted test doubles reachable from both the mock factories and specs.
const H = vi.hoisted(() => ({
  tImpl: (key: string, fallback?: unknown): string =>
    typeof fallback === 'string' ? fallback : key,
  captured: {} as Record<string, Record<string, unknown>>,
}))

// i18n → return the developer fallback string (2nd arg) or the key.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: H.tImpl,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

// Stub every child panel so we capture the exact props the orchestrator wired,
// and no child dependency (useUnits, real GlassPanel, lucide icons) has to boot
// inside jsdom.
vi.mock('./PowertrainPanel', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    PowertrainPanel: function PowertrainPanelStub(props: Record<string, unknown>) {
      H.captured.PowertrainPanel = props
      return React.createElement('div', { 'data-testid': 'panel-powertrain' })
    },
  }
})
vi.mock('./ClimatePanel', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    ClimatePanel: function ClimatePanelStub(props: Record<string, unknown>) {
      H.captured.ClimatePanel = props
      return React.createElement('div', { 'data-testid': 'panel-climate' })
    },
  }
})
vi.mock('./SecurityPanel', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    SecurityPanel: function SecurityPanelStub(props: Record<string, unknown>) {
      H.captured.SecurityPanel = props
      return React.createElement('div', { 'data-testid': 'panel-security' })
    },
  }
})
vi.mock('./VehicleStatePanel', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    VehicleStatePanel: function VehicleStatePanelStub(props: Record<string, unknown>) {
      H.captured.VehicleStatePanel = props
      return React.createElement('div', { 'data-testid': 'panel-vehicle-state' })
    },
  }
})
vi.mock('./TirePressurePanel', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    TirePressurePanel: function TirePressurePanelStub(props: Record<string, unknown>) {
      H.captured.TirePressurePanel = props
      return React.createElement('div', { 'data-testid': 'panel-tire' })
    },
  }
})
vi.mock('./EnergyChargingPanel', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    EnergyChargingPanel: function EnergyChargingPanelStub(props: Record<string, unknown>) {
      H.captured.EnergyChargingPanel = props
      return React.createElement('div', { 'data-testid': 'panel-energy-charging' })
    },
  }
})
vi.mock('./MediaNavigationPanel', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    MediaNavigationPanel: function MediaNavigationPanelStub(props: Record<string, unknown>) {
      H.captured.MediaNavigationPanel = props
      return React.createElement('div', { 'data-testid': 'panel-media-nav' })
    },
  }
})

import { LiveTelemetryPanels } from './LiveTelemetryPanels'

/* ── Fixtures — typed sentinels used for by-reference assertions ─────── */

const MOTOR = { ts: 'm', created_at: 'm', shift_state: 'D' } as unknown as MotorSnapshot
const CLIMATE = { vehicle_id: 1, ts: 'c' } as unknown as ClimateSnapshot
const SECURITY = { vehicle_id: 1, ts: 's', event_type: 'lock' } as unknown as SecurityEvent
const TIRE = { id: 1, vehicle_id: 1, front_left: 250000 } as unknown as TirePressureSnapshot
const CHARGING = { vehicle_id: 1, ts: 'ct' } as unknown as ChargingTelemetry
const MEDIA = { id: 1, vehicle_id: 1, created_at: 'md' } as unknown as MediaSnapshot
const LOCATION = { id: 1, destination_name: 'Home' } as unknown as LocationSnapshot
const LIVE: Record<string, unknown> = { lightsHighBeams: true, pairedKeyCount: 2 }

const PANEL_IDS = [
  'panel-powertrain',
  'panel-climate',
  'panel-security',
  'panel-vehicle-state',
  'panel-tire',
  'panel-energy-charging',
  'panel-media-nav',
]

type Props = Parameters<typeof LiveTelemetryPanels>[0]

const baseProps: Props = {
  motorData: MOTOR,
  climateData: CLIMATE,
  securityData: SECURITY,
  tireData: TIRE,
  chargingTelemetry: CHARGING,
  mediaData: MEDIA,
  locationData: LOCATION,
  live: LIVE,
  sseConnected: true,
  remoteStartEnabled: true,
}

function renderPanels(overrides: Partial<Props> = {}) {
  return render(<LiveTelemetryPanels {...baseProps} {...overrides} />)
}

beforeEach(() => {
  H.captured = {}
})

/* ── Specs ──────────────────────────────────────────────────────────── */

describe('LiveTelemetryPanels', () => {
  it('renders the Live Telemetry heading and hides the decorative pulse from assistive tech', () => {
    const { container } = renderPanels()

    const heading = screen.getByRole('heading', { level: 2, name: 'Live Telemetry' })
    expect(heading).toBeInTheDocument()
    expect(heading.tagName).toBe('H2')

    // The animated pulse indicator conveys nothing a screen reader needs — it
    // must be marked decorative.
    const decorative = container.querySelector('span[aria-hidden="true"]')
    expect(decorative).not.toBeNull()
  })

  it('mounts all seven telemetry panels unconditionally', () => {
    renderPanels()

    for (const id of PANEL_IDS) {
      expect(screen.getByTestId(id)).toBeInTheDocument()
    }
  })

  it('wires each panel to its own data source by reference and passes the flags through', () => {
    renderPanels()

    expect(H.captured.PowertrainPanel?.motorData).toBe(MOTOR)
    expect(H.captured.ClimatePanel?.climateData).toBe(CLIMATE)
    expect(H.captured.SecurityPanel?.securityData).toBe(SECURITY)
    expect(H.captured.SecurityPanel?.remoteStartEnabled).toBe(true)
    expect(H.captured.TirePressurePanel?.tireData).toBe(TIRE)
    expect(H.captured.EnergyChargingPanel?.chargingTelemetry).toBe(CHARGING)
    expect(H.captured.MediaNavigationPanel?.mediaData).toBe(MEDIA)
    expect(H.captured.MediaNavigationPanel?.locationData).toBe(LOCATION)
    expect(H.captured.VehicleStatePanel?.live).toBe(LIVE)
    expect(H.captured.VehicleStatePanel?.sseConnected).toBe(true)
  })

  it('passes nullish snapshots straight through so each panel can render its own empty state', () => {
    renderPanels({
      motorData: null,
      climateData: null,
      securityData: undefined,
      tireData: null,
      chargingTelemetry: null,
      mediaData: null,
      locationData: null,
      remoteStartEnabled: null,
    })

    // Sections still mount even with no data — no hidden panels.
    for (const id of PANEL_IDS) {
      expect(screen.getByTestId(id)).toBeInTheDocument()
    }

    // Nullish values are forwarded verbatim (not coerced to a truthy fallback).
    expect(H.captured.PowertrainPanel?.motorData).toBeNull()
    expect(H.captured.ClimatePanel?.climateData).toBeNull()
    expect(H.captured.SecurityPanel?.securityData).toBeUndefined()
    expect(H.captured.SecurityPanel?.remoteStartEnabled).toBeNull()
    expect(H.captured.TirePressurePanel?.tireData).toBeNull()
    expect(H.captured.EnergyChargingPanel?.chargingTelemetry).toBeNull()
    expect(H.captured.MediaNavigationPanel?.locationData).toBeNull()
  })

  it('coalesces a nullish live map to a single stable empty object (null-safety + perf)', () => {
    renderPanels({ live: undefined as unknown as Record<string, unknown> })
    const firstLive = H.captured.VehicleStatePanel?.live
    expect(firstLive).toEqual({})

    // A second nullish render must reuse the SAME shared object — the fallback
    // is a module constant, not a fresh literal allocated on every render.
    renderPanels({ live: null as unknown as Record<string, unknown> })
    expect(H.captured.VehicleStatePanel?.live).toBe(firstLive)
  })

  it('reflects the SSE connection and remote-start flags through to the relevant panels', () => {
    renderPanels({ sseConnected: false, remoteStartEnabled: false })

    expect(H.captured.VehicleStatePanel?.sseConnected).toBe(false)
    expect(H.captured.SecurityPanel?.remoteStartEnabled).toBe(false)
    // The live map is untouched when provided.
    expect(H.captured.VehicleStatePanel?.live).toBe(LIVE)
  })
})
