import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { IncidentsCard } from '../IncidentsCard'
import type {
  Incident,
  IncidentListResponse,
  IncidentSeverity,
  IncidentUpdateEntry,
} from '@/api/hooks/useIncidents'

// A fixed "now" so relative-time assertions are deterministic.
const NOW = Date.parse('2025-06-01T12:00:00Z')

// ── Drive the incidents query synchronously. The factory reads `queryState`
//    lazily (at hook-call time), which sidesteps vi.mock hoisting. ──
const queryState: { data: IncidentListResponse | undefined; calledWith: unknown } = {
  data: undefined,
  calledWith: undefined,
}

vi.mock('@/api/hooks/useIncidents', () => ({
  useIncidents: (params: unknown) => {
    queryState.calledWith = params
    return { data: queryState.data }
  },
}))

// ── Stub the IncidentForm dialog so we test the card's open/close wiring in
//    isolation (the real form owns its own network + toast internals). ──
vi.mock('../IncidentForm', () => ({
  IncidentForm: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Log an incident">
      <button type="button" onClick={onClose}>
        close-form
      </button>
    </div>
  ),
}))

let seq = 0

function makeUpdate(overrides: Partial<IncidentUpdateEntry> = {}): IncidentUpdateEntry {
  return {
    at: new Date(NOW).toISOString(),
    status: 'investigating',
    message: 'update',
    ...overrides,
  }
}

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  seq += 1
  return {
    id: seq,
    title: `Incident ${seq}`,
    description: '',
    severity: 'major',
    status: 'investigating',
    source: 'manual',
    affected_components: [],
    updates: [],
    started_at: new Date(NOW - 60_000).toISOString(),
    created_at: new Date(NOW - 60_000).toISOString(),
    updated_at: new Date(NOW - 60_000).toISOString(),
    ...overrides,
  }
}

function renderCard(now = NOW) {
  return render(
    <MemoryRouter>
      <IncidentsCard now={now} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  seq = 0
  queryState.data = undefined
  queryState.calledWith = undefined
})

describe('IncidentsCard', () => {
  it('queries active incidents only and collapses to nothing when there are none', () => {
    queryState.data = { incidents: [], count: 0 }
    const { container } = renderCard()

    expect(container.firstChild).toBeNull()
    expect(queryState.calledWith).toEqual({ activeOnly: true })
  })

  it('collapses to nothing while the query is loading or has errored (no data)', () => {
    queryState.data = undefined
    const { container } = renderCard()

    // A supplementary card must not push an empty panel or a scary error onto
    // the page before/while data resolves.
    expect(container.firstChild).toBeNull()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('renders the header, the active-count badge and the "Log incident" CTA', () => {
    queryState.data = { incidents: [makeIncident(), makeIncident()], count: 2 }
    renderCard()

    const heading = screen.getByRole('heading', { name: /Active incidents/, level: 3 })
    expect(heading).toBeInTheDocument()
    // Count badge sits inside the heading.
    expect(within(heading).getByText('2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Log incident/ })).toBeInTheDocument()
    // The list carries an accessible label for assistive tech.
    expect(screen.getByRole('list', { name: 'Active incidents' })).toBeInTheDocument()
  })

  it('renders a full incident row: title, status, severity, affected components, timing and link', () => {
    const inc = makeIncident({
      id: 42,
      title: 'Wall connector offline',
      severity: 'critical',
      status: 'identified',
      affected_components: ['tesla', 'telemetry'],
      updates: [makeUpdate(), makeUpdate(), makeUpdate()],
      started_at: new Date(NOW - 5 * 60_000).toISOString(),
    })
    queryState.data = { incidents: [inc], count: 1 }
    renderCard()

    const link = screen.getByRole('link', { name: /Wall connector offline/ })
    expect(link).toHaveAttribute('href', '/system-status/incidents/42')
    expect(screen.getByText('identified')).toBeInTheDocument()
    expect(screen.getByText('critical')).toBeInTheDocument()
    expect(screen.getByText('Affects: tesla, telemetry')).toBeInTheDocument()

    const timing = screen.getByText(/Started 5m ago/)
    expect(timing).toHaveTextContent('3 updates')
  })

  it('maps each severity to its own tone colour on the label', () => {
    queryState.data = {
      incidents: [
        makeIncident({ id: 1, title: 'Minor row', severity: 'minor' }),
        makeIncident({ id: 2, title: 'Major row', severity: 'major' }),
        makeIncident({ id: 3, title: 'Critical row', severity: 'critical' }),
      ],
      count: 3,
    }
    renderCard()

    expect(screen.getByText('minor')).toHaveClass('text-amber-300')
    expect(screen.getByText('major')).toHaveClass('text-orange-300')
    expect(screen.getByText('critical')).toHaveClass('text-red-400')
  })

  it('falls back to a safe "unknown" tone for a severity outside the known enum (no crash)', () => {
    const inc = makeIncident({
      id: 7,
      title: 'Weird severity',
      severity: 'catastrophic' as IncidentSeverity,
    })
    queryState.data = { incidents: [inc], count: 1 }
    renderCard()

    expect(screen.getByText('Weird severity')).toBeInTheDocument()
    const label = screen.getByText('unknown')
    expect(label).toHaveClass('text-[var(--text-muted)]')
  })

  it('survives null affected_components/updates (a Go nil slice serialises to null)', () => {
    const inc = makeIncident({
      id: 9,
      title: 'Nil slices',
      affected_components: null as unknown as string[],
      updates: null as unknown as IncidentUpdateEntry[],
    })
    queryState.data = { incidents: [inc], count: 1 }
    renderCard()

    // Row still renders — without the null-safety guards `.length` would throw.
    expect(screen.getByText('Nil slices')).toBeInTheDocument()
    expect(screen.queryByText(/^Affects:/)).not.toBeInTheDocument()
    expect(screen.getByText(/Started/)).not.toHaveTextContent('updates')
  })

  it('only shows the update count when there is more than one update', () => {
    queryState.data = {
      incidents: [makeIncident({ id: 3, title: 'Single update', updates: [makeUpdate()] })],
      count: 1,
    }
    renderCard()

    expect(screen.getByText(/Started/)).not.toHaveTextContent('updates')
  })

  it('formats relative start times across the minute/hour/day boundaries and invalid dates', () => {
    const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
    queryState.data = {
      incidents: [
        makeIncident({ id: 1, title: 'Alpha', started_at: iso(10_000) }),
        makeIncident({ id: 2, title: 'Bravo', started_at: iso(5 * 60_000) }),
        makeIncident({ id: 3, title: 'Charlie', started_at: iso(3 * 3_600_000) }),
        makeIncident({ id: 4, title: 'Delta', started_at: iso(2 * 86_400_000) }),
        makeIncident({ id: 5, title: 'Echo', started_at: 'not-a-date' }),
      ],
      count: 5,
    }
    renderCard()

    expect(screen.getByRole('link', { name: /Alpha/ })).toHaveTextContent('Started just now')
    expect(screen.getByRole('link', { name: /Bravo/ })).toHaveTextContent('Started 5m ago')
    expect(screen.getByRole('link', { name: /Charlie/ })).toHaveTextContent('Started 3h ago')
    expect(screen.getByRole('link', { name: /Delta/ })).toHaveTextContent('Started 2d ago')

    const echo = screen.getByRole('link', { name: /Echo/ })
    expect(echo).toHaveTextContent('Started')
    expect(echo).not.toHaveTextContent('ago')
  })

  it('opens the IncidentForm dialog from the CTA and closes it via onClose', () => {
    queryState.data = { incidents: [makeIncident({ id: 1, title: 'Row' })], count: 1 }
    renderCard()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Log incident/ }))
    const dialog = screen.getByRole('dialog', { name: 'Log an incident' })
    expect(dialog).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'close-form' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('falls back to a placeholder title when the incident title is empty', () => {
    queryState.data = {
      incidents: [makeIncident({ id: 11, title: '', affected_components: ['charger'] })],
      count: 1,
    }
    renderCard()

    expect(screen.getByText('Untitled incident')).toBeInTheDocument()
    expect(screen.getByText('Affects: charger')).toBeInTheDocument()
  })
})
