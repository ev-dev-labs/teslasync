/**
 * Fleet Posture panel.
 *
 * This is the panel that told an operator "Unknown" while the dashboard hero
 * said "Charging" for the same car. The contract pinned here is therefore
 * mostly about HONESTY rather than layout:
 *
 *   - the six-way taxonomy is always rendered in full (including zeros), and
 *     it separates a claim about the VEHICLE (offline) from claims about our
 *     EVIDENCE (unverified / last-known / no-state / unreachable);
 *   - verified coverage is stated as "N of M verified";
 *   - the age shown is the OLDEST real backend observation, never a fetch
 *     time, and a retained reading keeps its original age;
 *   - the panel never disappears when there is no data;
 *   - colour is never the only signal (every category carries an icon and a
 *     text label), and posture changes are announced via `aria-live`.
 *
 * `react-i18next` is stubbed with an interpolating passthrough so assertions
 * read the English defaults without booting the i18n runtime.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/feedback'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const fallback = typeof defaultValue === 'string' ? defaultValue : key
      const vars = (typeof defaultValue === 'object' ? defaultValue : options) ?? {}
      return fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String((vars as Record<string, unknown>)[name] ?? `{{${name}}}`))
    },
  }),
}))

import type { FleetServerSummary, FleetStateEntry } from '@/api/hooks/useVehicles'
import type { Vehicle } from '@/types/vehicle'
import { FleetOperationsBrief } from './FleetOperationsBrief'

function makeVehicle(id: number, name = `Car ${id}`): Vehicle {
  return {
    id,
    vehicle_id: id,
    vin: `VIN${id}`,
    display_name: name,
    model: 'model3',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  } as Vehicle
}

function entry(vehicle: Vehicle, over: Partial<FleetStateEntry> = {}): FleetStateEntry {
  return {
    vehicle,
    state: { vehicle_id: vehicle.id, state: 'online' } as FleetStateEntry['state'],
    outcome: 'resolved',
    freshness: 'fresh',
    verifiedFields: ['state'],
    stale: false,
    observedAt: Date.now() - 5_000,
    receivedAt: Date.now(),
    ...over,
  }
}

function renderBrief(props: Partial<React.ComponentProps<typeof FleetOperationsBrief>> = {}) {
  const vehicles = props.vehicles ?? [makeVehicle(1)]
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>
          <FleetOperationsBrief
            vehicles={vehicles}
            selectedVehicle={props.selectedVehicle ?? null}
            fleetStates={props.fleetStates}
            summary={props.summary}
            isPending={props.isPending}
            isError={props.isError}
            onRetry={props.onRetry}
            isRetrying={props.isRetrying}
          />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

/** A server-derived summary, as `useFleetStates` publishes it. */
function serverSummary(over: Partial<FleetServerSummary> = {}): FleetServerSummary {
  return {
    counted: 4,
    verifiedCount: 3,
    attentionCount: 1,
    operational: { charging: 1, driving: 1, parked: 1, asleep: 0, online: 0, offline: 0, other: 0 },
    attention: { unverified: 1, stale: 0, unknown: 0, missing: 0, failed: 0 },
    oldestObservedAt: Date.now() - 90_000,
    newestObservedAt: Date.now() - 5_000,
    observedCount: 3,
    ...over,
  }
}

/** Taxonomy/metric value for a label, read out of its own <dd>. */
function valueFor(label: string): string {
  const panel = screen.getByTestId('fleet-operations-brief')
  return within(panel).getByText(label).parentElement?.querySelector('dd')?.textContent ?? ''
}

afterEach(cleanup)

describe('FleetOperationsBrief — taxonomy', () => {
  it('renders the panel with an explicit taxonomy even before any data arrives', () => {
    renderBrief({ fleetStates: undefined, isPending: true })

    // The panel is NEVER hidden on no data.
    expect(screen.getByTestId('fleet-operations-brief')).toBeInTheDocument()
    expect(screen.getByTestId('fleet-posture-taxonomy')).toBeInTheDocument()
    expect(screen.getByText('Checking live state')).toBeInTheDocument()
    // Counts are em dashes, not a confident zero.
    expect(valueFor('Reporting')).toBe('—')
    expect(valueFor('Offline')).toBe('—')
  })

  it('separates offline from unverified, last-known, no-state and unreachable', () => {
    const vehicles = [1, 2, 3, 4, 5, 6].map((id) => makeVehicle(id))
    const now = Date.now()
    renderBrief({
      vehicles,
      fleetStates: [
        entry(vehicles[0]),
        entry(vehicles[1], {
          state: { vehicle_id: 2, state: 'offline' } as FleetStateEntry['state'],
        }),
        entry(vehicles[2], { freshness: 'stale', stale: true, observedAt: now - 600_000 }),
        entry(vehicles[3], {
          outcome: 'failed',
          freshness: 'stale',
          stale: true,
          observedAt: now - 900_000,
          error: new Error('gateway timeout'),
        }),
        entry(vehicles[4], { outcome: 'missing', state: null, freshness: 'unknown', observedAt: null }),
        entry(vehicles[5], {
          outcome: 'failed',
          state: null,
          freshness: 'unknown',
          observedAt: null,
          error: new Error('ECONNREFUSED'),
        }),
      ],
    })

    expect(valueFor('Reporting')).toBe('1')
    expect(valueFor('Offline')).toBe('1')
    expect(valueFor('Unverified')).toBe('1')
    expect(valueFor('Last known')).toBe('1')
    expect(valueFor('No state')).toBe('1')
    expect(valueFor('Unreachable')).toBe('1')
  })

  it('states verified coverage as a fraction of the fleet', () => {
    const vehicles = [makeVehicle(1), makeVehicle(2), makeVehicle(3)]
    renderBrief({
      vehicles,
      fleetStates: [
        entry(vehicles[0]),
        entry(vehicles[1]),
        entry(vehicles[2], { freshness: 'stale', stale: true }),
      ],
    })

    expect(screen.getByText('2 of 3 verified')).toBeInTheDocument()
    expect(valueFor('Verified')).toContain('2/3')
  })

  it('reports the OLDEST real observation, not the newest and not a fetch time', () => {
    const vehicles = [makeVehicle(1), makeVehicle(2)]
    const now = Date.now()
    renderBrief({
      vehicles,
      fleetStates: [
        entry(vehicles[0], { observedAt: now - 2_000 }),
        // Retained through a failure: age keeps growing, and it is the age the
        // summary must present.
        entry(vehicles[1], {
          outcome: 'failed',
          stale: true,
          freshness: 'stale',
          observedAt: now - 3 * 60 * 60_000,
          error: new Error('boom'),
        }),
      ],
    })

    expect(valueFor('Oldest reading')).toContain('3h ago')
    expect(valueFor('Oldest reading')).toContain('observed, not fetched')
  })

  it('says so explicitly when there is no verified observation at all', () => {
    const vehicle = makeVehicle(1)
    renderBrief({
      vehicles: [vehicle],
      fleetStates: [entry(vehicle, {
        outcome: 'missing', state: null, freshness: 'unknown', observedAt: null,
      })],
    })

    expect(valueFor('Oldest reading')).toContain('no verified observation')
  })
})

describe('FleetOperationsBrief — server-derived summary', () => {
  it('uses authoritative totals from the same resolved snapshot', () => {
    const vehicles = [1, 2, 3, 4].map((id) => makeVehicle(id))
    renderBrief({
      vehicles,
      fleetStates: [
        entry(vehicles[0]),
        entry(vehicles[1]),
        entry(vehicles[2]),
        entry(vehicles[3], { verifiedFields: [] }),
      ],
      summary: serverSummary(),
    })

    expect(valueFor('Reporting')).toBe('3')
    expect(valueFor('Offline')).toBe('0')
    expect(valueFor('Unverified')).toBe('1')
    expect(valueFor('Verified')).toContain('3/4')
    expect(valueFor('Attention')).toContain('1')
    expect(screen.getByText('3 of 4 verified')).toBeInTheDocument()
    expect(valueFor('Oldest reading')).toContain('1m ago')
  })

  it('counts unknown evidence without turning it into an offline vehicle', () => {
    const vehicles = [1, 2, 3].map((id) => makeVehicle(id))
    const observedAt = Date.now() - 90_000
    renderBrief({
      vehicles,
      fleetStates: [
        entry(vehicles[0], { observedAt, verifiedFields: [] }),
        entry(vehicles[1], {
          freshness: 'unknown',
          observedAt: null,
          verifiedFields: [],
        }),
        entry(vehicles[2], {
          outcome: 'missing',
          state: null,
          freshness: 'unknown',
          observedAt: null,
          verifiedFields: [],
        }),
      ],
      summary: serverSummary({
        counted: 3,
        verifiedCount: 0,
        attentionCount: 3,
        operational: { charging: 0, driving: 0, parked: 0, asleep: 0, online: 0, offline: 0, other: 0 },
        attention: { unverified: 1, stale: 0, unknown: 1, missing: 1, failed: 0 },
        oldestObservedAt: observedAt,
        newestObservedAt: observedAt,
        observedCount: 1,
      }),
    })

    expect(valueFor('Offline')).toBe('0')
    expect(valueFor('Unverified')).toBe('2')
    expect(valueFor('No state')).toBe('1')
    expect(valueFor('Attention')).toContain('3')
    expect(valueFor('Oldest reading')).toContain('1m ago')
  })

  it('does not present a detached summary as resolved vehicle data', () => {
    const vehicle = makeVehicle(1)
    renderBrief({
      vehicles: [vehicle],
      selectedVehicle: vehicle,
      fleetStates: undefined,
      isPending: true,
      summary: serverSummary({ counted: 1, verifiedCount: 1, attentionCount: 0 }),
    })

    expect(screen.getByText('Checking')).toBeInTheDocument()
    expect(valueFor('Reporting')).toBe('—')
  })

  it('prefers the client derivation once freshness no longer matches the summary', () => {
    const vehicles = [makeVehicle(1), makeVehicle(2)]
    renderBrief({
      vehicles,
      fleetStates: [
        entry(vehicles[0]),
        entry(vehicles[1], { freshness: 'stale', stale: true }),
      ],
      // A stale summary from an earlier batch must not override what the
      // client can now see (and age) for itself.
      summary: serverSummary({ counted: 2, verifiedCount: 2, attentionCount: 0 }),
    })

    expect(valueFor('Verified')).toContain('1/2')
    expect(valueFor('Unverified')).toBe('1')
  })

  it('falls back to em dashes when neither entries nor a summary exist', () => {
    renderBrief({ vehicles: [makeVehicle(1)], fleetStates: undefined, summary: null, isPending: true })

    expect(valueFor('Reporting')).toBe('—')
    expect(valueFor('Verified')).toContain('—')
    expect(screen.getByText('Checking live state')).toBeInTheDocument()
  })
})

describe('FleetOperationsBrief — trust and accessibility', () => {
  it('announces the posture headline in a polite live region', () => {
    const vehicles = [makeVehicle(1), makeVehicle(2)]
    renderBrief({
      vehicles,
      fleetStates: [entry(vehicles[0]), entry(vehicles[1])],
    })

    const announcement = screen.getByTestId('fleet-posture-announcement')
    expect(announcement).toHaveAttribute('aria-live', 'polite')
    expect(announcement).toHaveTextContent('All 2 vehicles verified from current telemetry.')
  })

  it('distinguishes a transport failure from a fleet of offline cars', () => {
    const vehicle = makeVehicle(1)
    renderBrief({
      vehicles: [vehicle],
      isError: true,
      fleetStates: [entry(vehicle, {
        outcome: 'failed',
        stale: true,
        freshness: 'stale',
        error: new Error('ECONNREFUSED'),
      })],
    })

    expect(screen.getByText('Live state unavailable')).toBeInTheDocument()
    expect(screen.getByTestId('fleet-posture-announcement')).toHaveTextContent(
      'Live state could not be read.',
    )
    expect(valueFor('Offline')).toBe('0')
    expect(valueFor('Last known')).toBe('1')
  })

  it('keeps the scoped vehicle Unknown rather than claiming offline', () => {
    const vehicle = makeVehicle(1, 'Falcon')
    renderBrief({
      vehicles: [vehicle],
      selectedVehicle: vehicle,
      fleetStates: [entry(vehicle, {
        outcome: 'failed', state: null, freshness: 'unknown', observedAt: null,
        error: new Error('gateway timeout'),
      })],
    })

    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.queryByText('offline')).not.toBeInTheDocument()
    expect(
      screen.getByText('The live-state request failed. This is a fact about our pipeline, not about the vehicle.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('No verified observation time for this vehicle'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry live-state read' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run system diagnostic' })).toBeInTheDocument()
  })

  it('offers a scoped wake action only for verified offline telemetry', () => {
    const vehicle = makeVehicle(1, 'Falcon')
    renderBrief({
      vehicles: [vehicle],
      selectedVehicle: vehicle,
      fleetStates: [entry(vehicle, {
        state: { vehicle_id: 1, state: 'offline' } as FleetStateEntry['state'],
      })],
    })

    expect(screen.getByRole('button', { name: 'Wake scoped vehicle' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run system diagnostic' })).not.toBeInTheDocument()
  })

  it('pairs every taxonomy category with an icon so colour is never the only signal', () => {
    const vehicle = makeVehicle(1)
    const { container } = renderBrief({ vehicles: [vehicle], fleetStates: [entry(vehicle)] })

    const taxonomy = within(container).getByTestId('fleet-posture-taxonomy')
    // Six categories, each with a decorative icon next to its text label.
    expect(taxonomy.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThanOrEqual(6)
    for (const label of ['Reporting', 'Offline', 'Unverified', 'Last known', 'No state', 'Unreachable']) {
      expect(within(taxonomy).getByText(label)).toBeInTheDocument()
    }
  })

  it('offers keyboard-reachable evidence drill-through and workflow navigation', () => {
    const vehicle = makeVehicle(1)
    renderBrief({ vehicles: [vehicle], selectedVehicle: vehicle, fleetStates: [entry(vehicle)] })

    const investigate = screen.getByRole('navigation', { name: 'Investigate fleet posture' })
    const hrefs = within(investigate)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
    expect(hrefs).toContain('/signals')
    expect(hrefs).toContain('/system-status')
    expect(hrefs).toContain('/admin/live-signals')
    expect(hrefs).toContain('/vehicles/1')

    // The pre-existing workflow shortcuts are preserved, not replaced.
    const workflows = screen.getByRole('navigation', { name: 'Primary workflows' })
    expect(within(workflows).getAllByRole('link').length).toBe(4)

    // Every link is a real anchor, so it is focusable and Enter-activatable
    // without any custom key handling.
    for (const link of within(investigate).getAllByRole('link')) {
      expect(link.tagName).toBe('A')
      expect(link.className).toContain('focus-visible:ring-2')
    }
  })

  it('drops the vehicle drill-through when nothing is in scope', () => {
    renderBrief({ vehicles: [], fleetStates: [] })
    const investigate = screen.getByRole('navigation', { name: 'Investigate fleet posture' })
    const hrefs = within(investigate)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
    expect(hrefs.some((href) => href?.startsWith('/vehicles/'))).toBe(false)
  })
})
