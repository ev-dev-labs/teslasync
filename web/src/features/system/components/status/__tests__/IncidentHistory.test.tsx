import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useIncidents } from '@/api/hooks/useIncidents'
import { IncidentHistory } from '../IncidentHistory'

vi.mock('@/api/hooks/useIncidents', () => ({ useIncidents: vi.fn() }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

const mockUseIncidents = vi.mocked(useIncidents)

function renderHistory() {
  return render(<MemoryRouter><IncidentHistory /></MemoryRouter>)
}

beforeEach(() => {
  mockUseIncidents.mockReset()
})

describe('IncidentHistory', () => {
  it('shows a loading state without claiming healthy history', () => {
    mockUseIncidents.mockReturnValue({ isLoading: true } as ReturnType<typeof useIncidents>)
    renderHistory()
    expect(screen.getByRole('status', { name: 'Loading incident history' })).toBeInTheDocument()
  })

  it('does not infer uptime from no recorded incidents', () => {
    mockUseIncidents.mockReturnValue({ data: { incidents: [], count: 0 } } as ReturnType<typeof useIncidents>)
    renderHistory()
    expect(screen.getByText('No incidents recorded. This does not establish historical uptime.')).toBeInTheDocument()
  })

  it('shows a failed history request instead of an empty state', () => {
    mockUseIncidents.mockReturnValue({
      error: new Error('network'),
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useIncidents>)
    renderHistory()
    expect(screen.getByText("Can't reach server")).toBeInTheDocument()
    expect(screen.queryByText('No incidents recorded. This does not establish historical uptime.')).not.toBeInTheDocument()
  })

  it('shows recorded incidents with component, timestamp and outcome', () => {
    mockUseIncidents.mockReturnValue({
      data: {
        count: 1,
        incidents: [{
          id: 7,
          title: 'Database restart',
          started_at: '2026-09-20T10:00:00Z',
          affected_components: ['database'],
          status: 'resolved',
        }],
      },
    } as ReturnType<typeof useIncidents>)
    renderHistory()
    const link = screen.getByRole('link', { name: /Database restart/ })
    expect(link).toHaveAttribute('href', '/system-status/incidents/7')
    expect(screen.getByText(/database/)).toBeInTheDocument()
    expect(screen.getByText('resolved')).toBeInTheDocument()
  })
})
