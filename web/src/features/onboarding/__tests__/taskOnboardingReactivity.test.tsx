import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/i18n'

import { TaskOnboardingHost } from '../components/TaskOnboardingHost'
import { __resetOnboardingTasksForTests } from '@/lib/onboardingTasks'

/**
 * HELP-01 reactivity (correction round).
 *
 * The regression these tests exist to prevent: evidence was read inside a
 * `useMemo` whose dependencies (`queryClient`, a literal string) never change,
 * so it ran once at mount and froze. Because the host mounts with the shell —
 * long before any page query resolves — every count was permanently "nothing
 * observed" and four of the five tasks could never fire.
 *
 * Every case below therefore mounts the host FIRST and seeds the cache
 * afterwards, which is the real ordering in the app.
 */

const mockVehicles = vi.hoisted(() => ({ current: [] as Array<{ id: number }> }))

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: mockVehicles.current }),
}))

function setup(initialPath: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="*" element={<TaskOnboardingHost />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { client, ...utils }
}

/** Seed a query the way a page's resolved `queryFn` would. */
function seed(client: QueryClient, key: readonly unknown[], data: unknown) {
  act(() => {
    client.setQueryData(key, data)
  })
}

function hintId(): string | null {
  return screen.queryByTestId('task-onboarding-hint')?.getAttribute('data-task-id') ?? null
}

beforeEach(() => {
  window.localStorage.clear()
  __resetOnboardingTasksForTests()
  mockVehicles.current = [{ id: 1 }]
})

describe('task onboarding — evidence arriving after mount', () => {
  it('surfaces the automation task once an empty automations list resolves', () => {
    const { client } = setup('/automations')
    // Nothing observed yet → nothing may fire.
    expect(hintId()).toBeNull()

    seed(client, ['automations'], [])

    expect(hintId()).toBe('first-automation')
  })

  it('does not surface the automation task when the list resolves non-empty', () => {
    const { client } = setup('/automations')
    seed(client, ['automations'], [{ id: 1, name: 'A' }])
    expect(hintId()).toBeNull()
  })

  it('retracts the hint when the automations list later becomes non-empty', () => {
    const { client } = setup('/automations')
    seed(client, ['automations'], [])
    expect(hintId()).toBe('first-automation')

    // The user created one in another tab / the mutation settled.
    seed(client, ['automations'], [{ id: 1, name: 'A' }])
    expect(hintId()).toBeNull()
  })

  it('decodes a non-array automations payload the way useAutomations does', () => {
    // `useAutomations` applies `select: safeArray`, so a malformed object
    // response decodes to an empty list rather than to "unknown".
    const { client } = setup('/automations')
    seed(client, ['automations'], { items: [] })
    expect(hintId()).toBe('first-automation')
  })

  it('reads the paginated cache shape the /charging page actually writes', () => {
    const { client } = setup('/charging')
    seed(client, ['settings'], { base_cost_per_kwh: 0 })
    expect(hintId()).toBeNull()

    // This is the literal key `useChargingSessionsPaginated` builds:
    // ['charging', vehicleId, start, end, limit, offset].
    seed(client, ['charging', 1, undefined, undefined, 50, 0], [{ id: 1 }, { id: 2 }])

    expect(hintId()).toBe('first-charging-cost')
  })

  it('suppresses the paginated-shape hint once a tariff is configured', () => {
    const { client } = setup('/charging')
    seed(client, ['charging', 1, undefined, undefined, 50, 0], [{ id: 1 }])
    seed(client, ['settings'], { base_cost_per_kwh: 0.28 })

    expect(hintId()).toBeNull()
  })

  it('also reads the non-paginated root used by other charging surfaces', () => {
    const { client } = setup('/charging')
    seed(client, ['settings'], { base_cost_per_kwh: 0 })
    seed(client, ['charging-sessions', 'vehicle', '1'], [{ id: 1 }])
    expect(hintId()).toBe('first-charging-cost')
  })

  it('combines both charging roots with max-defined semantics', () => {
    const { client } = setup('/charging')
    seed(client, ['settings'], { base_cost_per_kwh: 0 })
    // One root observed as empty, the other with rows. An empty (or absent)
    // root must not drag the observed one down to "no sessions".
    seed(client, ['charging-sessions', 'vehicle', '1'], [])
    seed(client, ['charging', 1, undefined, undefined, 50, 0], [{ id: 1 }, { id: 2 }])
    expect(hintId()).toBe('first-charging-cost')
  })

  it('keeps the charging-cost hint unknown-suppressed until settings resolve', () => {
    const { client } = setup('/charging')
    seed(client, ['charging-sessions', 'vehicle', '1'], [{ id: 1 }])
    // Settings not observed → tariff unknown → no hint.
    expect(hintId()).toBeNull()

    seed(client, ['settings'], { base_cost_per_kwh: 0 })
    expect(hintId()).toBe('first-charging-cost')
  })

  it('takes the LARGEST observed list so a filtered window is not read as empty', () => {
    const { client } = setup('/charging')
    seed(client, ['settings'], { base_cost_per_kwh: 0 })
    seed(client, ['charging-sessions', 'vehicle', '1'], [{ id: 1 }, { id: 2 }])
    // A narrower window returning zero rows must not retract the hint by
    // making the count look like zero — it makes it look like "no sessions".
    seed(client, ['charging-sessions', 'history', '1', 1000], [])
    expect(hintId()).toBe('first-charging-cost')
  })

  it('ignores sibling detail queries that share the charging root', () => {
    const { client } = setup('/charging')
    seed(client, ['settings'], { base_cost_per_kwh: 0 })
    // A detail query caches an object under the same root; it is not a list.
    seed(client, ['charging-sessions', '42'], { id: 42, total_energy_added_wh: 1 })
    expect(hintId()).toBeNull()
  })
})

describe('task onboarding — live telemetry evidence', () => {
  it('stays silent while telemetry evidence is unknown', () => {
    setup('/signals')
    expect(hintId()).toBeNull()
  })

  it('fires when a live-signals response reports zero signals', () => {
    const { client } = setup('/signals')
    seed(client, ['typed-signals', 'live', 1], {
      vehicle_id: 1,
      count: 0,
      at: '2026-01-01T00:00:00Z',
      signals: {},
    })
    expect(hintId()).toBe('enable-live-telemetry')
  })

  it('stays silent when live signals are actually flowing', () => {
    const { client } = setup('/signals')
    seed(client, ['typed-signals', 'live', 1], {
      vehicle_id: 1,
      count: 12,
      at: '2026-01-01T00:00:00Z',
      signals: { Soc: { kind: 'float', value: 80 } },
    })
    expect(hintId()).toBeNull()
  })

  it('falls back to the fleet-telemetry coverage map when no live read exists', () => {
    const { client } = setup('/signals')
    seed(client, ['fleet-telemetry', 'coverage'], {
      categories: [],
      destination_totals: {},
      orphan_fields: [],
    })
    expect(hintId()).toBe('enable-live-telemetry')
  })

  it('treats a configured coverage map as telemetry present', () => {
    const { client } = setup('/signals')
    seed(client, ['fleet-telemetry', 'coverage'], {
      categories: [],
      destination_totals: { mqtt: 42 },
      orphan_fields: [],
    })
    expect(hintId()).toBeNull()
  })

  it('prefers direct live observation over the configuration map', () => {
    const { client } = setup('/signals')
    // Configuration says telemetry is wired…
    seed(client, ['fleet-telemetry', 'coverage'], {
      categories: [],
      destination_totals: { mqtt: 42 },
      orphan_fields: [],
    })
    // …but the vehicle is actually reporting nothing.
    seed(client, ['typed-signals', 'live', 1], {
      vehicle_id: 1,
      count: 0,
      at: '2026-01-01T00:00:00Z',
      signals: {},
    })
    expect(hintId()).toBe('enable-live-telemetry')
  })
})

describe('task onboarding — unknown vs zero', () => {
  it('does not fire the vehicle task while the fleet query is unresolved', () => {
    mockVehicles.current = undefined as unknown as Array<{ id: number }>
    const { container } = setup('/')
    expect(container).toBeEmptyDOMElement()
  })

  it('fires the vehicle task once the fleet is observed to be empty', () => {
    mockVehicles.current = []
    setup('/')
    expect(hintId()).toBe('link-vehicle')
  })

  it('ignores a pending query that has no data yet', () => {
    const { client } = setup('/automations')
    act(() => {
      // A mounted-but-unresolved query exists in the cache with data
      // `undefined`; it must read as unknown, not as an empty list.
      client.getQueryCache().build(client, { queryKey: ['automations'] })
    })
    expect(hintId()).toBeNull()
  })
})
