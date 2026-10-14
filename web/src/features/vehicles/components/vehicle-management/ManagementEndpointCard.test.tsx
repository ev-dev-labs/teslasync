import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { ManagementEndpointCard } from './ManagementEndpointCard'

const preferences = vi.hoisted(() => ({
  locale: 'en-US',
  timezone: 'UTC',
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { tz_display_default: 'user' },
    locale: preferences.locale,
  }),
}))

vi.mock('@/lib/timezone', () => ({
  useTimezone: () => preferences.timezone,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        fallback ?? key,
      ),
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
  beforeEach(() => {
    preferences.locale = 'en-US'
    preferences.timezone = 'UTC'
  })

  it('formats the raw cached instant with current locale and timezone preferences', () => {
    const props = { ...baseProps, data: Object.freeze({ model: 'Model 3' }) }
    const { rerender } = render(
      <MemoryRouter><ManagementEndpointCard {...props} /></MemoryRouter>,
    )
    const expectedTime = (locale: string, timeZone: string) =>
      new Intl.DateTimeFormat(locale, {
        timeZone,
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      }).format(new Date(baseProps.fetchedAt))

    expect(screen.getByText(`Cached ${expectedTime('en-US', 'UTC')}`)).toBeInTheDocument()

    preferences.locale = 'de-DE'
    preferences.timezone = 'America/Los_Angeles'
    rerender(<MemoryRouter><ManagementEndpointCard {...props} /></MemoryRouter>)

    expect(screen.getByText(`Cached ${expectedTime('de-DE', 'America/Los_Angeles')}`)).toBeInTheDocument()
    expect(screen.queryByText(`Cached ${expectedTime('en-US', 'UTC')}`)).not.toBeInTheDocument()
    expect(screen.getByText('Model 3')).toBeInTheDocument()
    expect(props.fetchedAt).toBe('2026-08-08T12:00:00Z')
    expect(props.data).toEqual({ model: 'Model 3' })
  })

  it('preserves the not-cached state when no source timestamp exists', () => {
    render(<MemoryRouter><ManagementEndpointCard {...baseProps}
      fetchedAt={null} data={{ model: 'Model 3' }}
    /></MemoryRouter>)
    expect(screen.getByText('Not cached')).toBeInTheDocument()
    expect(screen.getByText('Model 3')).toBeInTheDocument()
    expect(screen.queryByText(/^Cached /)).not.toBeInTheDocument()
  })

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
