import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Incident, IncidentListResponse, IncidentUpdateEntry } from '@/api/hooks/useIncidents'
import catalog from '@/i18n/en.json'
import systemLocale from '@/i18n/en/locale-system.json'
import { IncidentsCard } from './IncidentsCard'

vi.unmock('react-i18next')

const query = vi.hoisted(() => ({
  data: undefined as IncidentListResponse | undefined,
  error: null as Error | null,
  refetch: vi.fn(),
  useIncidents: vi.fn(),
}))
vi.mock('@/api/hooks/useIncidents', () => ({
  useIncidents: (params: unknown) => {
    query.useIncidents(params)
    return {
      data: query.data, error: query.error, isError: !!query.error,
      isPending: !query.data && !query.error, isLoading: !query.data && !query.error,
      isFetching: false, dataUpdatedAt: query.data ? 1 : 0, refetch: query.refetch,
    }
  },
}))
vi.mock('./IncidentForm', () => ({
  IncidentForm: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Incident form">
      <button type="button" onClick={onClose}>Close form</button>
    </div>
  ),
}))

const english = createInstance()
const now = Date.parse('2026-10-10T12:00:00Z')
function incident(count: number | null | undefined): Incident {
  const update: IncidentUpdateEntry = {
    at: new Date(now).toISOString(), status: 'investigating', message: 'Operator update',
  }
  return {
    id: 42, title: 'Wall connector offline', description: '', severity: 'critical',
    status: 'identified', source: 'manual', affected_components: ['telemetry'],
    updates: count == null
      ? count as unknown as IncidentUpdateEntry[]
      : Array.from({ length: count }, () => ({ ...update })),
    started_at: new Date(now - 300_000).toISOString(),
    created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
  }
}
function renderCard() {
  return render(
    <I18nextProvider i18n={english}>
      <MemoryRouter><IncidentsCard now={now} /></MemoryRouter>
    </I18nextProvider>,
  )
}
beforeAll(async () => {
  await english.init({
    lng: 'en', fallbackLng: 'en',
    resources: { en: { translation: systemLocale } },
    interpolation: { escapeValue: false },
  })
})
beforeEach(() => {
  query.data = undefined
  query.error = null
  query.refetch.mockClear()
  query.useIncidents.mockClear()
})
afterEach(cleanup)

describe('incident update count with real generated English', () => {
  it('ships only the approved plural scalar, without a singular or root alias', () => {
    expect(catalog.systemStatus.incidents.updateCount_other).toBe('{{count}} updates')
    expect(systemLocale.systemStatus.incidents.updateCount_other).toBe('{{count}} updates')
    expect(english.exists('systemStatus.incidents.updateCount_one')).toBe(false)
    expect(english.exists('systemStatus.incidents.updateCount')).toBe(false)
  })

  it.each([0, 1, 2, 3, null, undefined])('preserves suffix visibility and incident evidence at %s updates', count => {
    query.data = { incidents: [incident(count)], count: 1 }
    renderCard()
    const timing = screen.getByText(/Started 5m ago/)
    expect(timing.textContent).toBe(`Started 5m ago${count != null && count > 1 ? ` · ${count} updates` : ''}`)
    expect(timing.textContent).not.toMatch(/systemStatus|\{\{count\}\}|\[object Object\]/)
    expect(screen.getByRole('heading', { name: /Active incidents/, level: 3 })).toHaveTextContent('1')
    expect(screen.getByRole('list', { name: 'Active incidents' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Wall connector offline/ }))
      .toHaveAttribute('href', '/system-status/incidents/42')
    expect(screen.getByText('identified')).toBeInTheDocument()
    expect(screen.getByText('critical')).toBeInTheDocument()
    expect(screen.getByText('Affects: telemetry')).toBeInTheDocument()
    expect(query.useIncidents).toHaveBeenCalledWith({ activeOnly: true })
  })

  it('keeps initial loading distinct from confirmed empty data', () => {
    const view = renderCard()
    expect(screen.getByRole('status', { name: 'Loading Active incidents' })).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    view.unmount()
    query.data = { incidents: [], count: 0 }
    expect(renderCard().container.firstChild).toBeNull()
  })

  it('retains fatal-error recovery and form access', () => {
    query.error = new Error('Incident source unavailable')
    renderCard()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Log incident' }))
    expect(screen.getByRole('dialog', { name: 'Incident form' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close form' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('retains update evidence on a failed refresh', () => {
    query.data = { incidents: [incident(3)], count: 1 }
    query.error = new Error('Refresh failed')
    renderCard()
    expect(screen.getByText('Started 5m ago · 3 updates')).toBeInTheDocument()
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log incident' })).toBeEnabled()
  })
})
