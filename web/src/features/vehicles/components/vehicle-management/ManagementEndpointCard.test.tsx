import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { ManagementEndpointCard } from './ManagementEndpointCard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

const baseProps = {
  endpointId: 'vehicle-specs',
  title: 'Vehicle specifications',
  description: 'Returned Tesla specification fields',
  endpoint: '/api/1/vehicles/{vehicle_id}/vehicle_specs',
  prerequisite: 'user' as const,
  kind: 'specs' as const,
  fetchedAt: '2026-08-08T12:00:00Z',
}

describe('ManagementEndpointCard preservation', () => {
  it('retains cached specifications, endpoint identity and refresh controls on a failed refresh', () => {
    const onRefresh = vi.fn()
    render(<MemoryRouter><ManagementEndpointCard {...baseProps}
      data={{ model: 'Model 3', exterior_color: 'Midnight Silver Metallic' }}
      error={new Error('refresh failed')} onRefresh={onRefresh}
    /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: baseProps.title })).toBeInTheDocument()
    const card = document.querySelector('[data-management-endpoint="vehicle-specs"]')
    if (!(card instanceof HTMLElement)) throw new Error('Endpoint identity missing')
    expect(within(card).getByText(baseProps.endpoint)).toBeInTheDocument()
    expect(within(card).getByText('Model 3')).toBeInTheDocument()
    expect(within(card).getByText('Midnight Silver Metallic')).toBeInTheDocument()
    expect(within(card).getByText('Data may be stale')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Refresh from Tesla' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('keeps a completed empty response distinct from a failed initial read', () => {
    render(<MemoryRouter><ManagementEndpointCard {...baseProps}
      data={{}} error={new Error('refresh failed')}
    /></MemoryRouter>)
    expect(screen.getByText('No matching data returned')).toBeInTheDocument()
    expect(screen.getByText('Data may be stale')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('preserves prerequisite-denial context alongside cached data', () => {
    render(<MemoryRouter><ManagementEndpointCard {...baseProps}
      data={{ model: 'Model 3' }} error={new ApiError('Partner scope required', 412)}
    /></MemoryRouter>)
    expect(screen.getByText('Model 3')).toBeInTheDocument()
    expect(screen.getByText('Prerequisite required')).toBeInTheDocument()
    expect(screen.getByText('Partner scope required')).toBeInTheDocument()
  })
})
