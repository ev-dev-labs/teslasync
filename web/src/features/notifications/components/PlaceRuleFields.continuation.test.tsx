import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PlaceRuleFields } from './PlaceRuleFields'

const source = vi.hoisted(() => ({
  data: [{ id: 7, name: 'Complete retained place name', enabled: true }] as
    Array<{ id: number; name: string; enabled: boolean }> | undefined,
  error: null as Error | null,
  retry: vi.fn(),
}))

vi.mock('@/api/hooks/useLocations', () => ({
  useGeofencesFull: () => ({
    data: source.data, error: source.error, isError: source.error != null,
    isLoading: source.data === undefined && source.error == null, refetch: source.retry,
  }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? '')),
    i18n: { language: 'en' },
  }),
}))

function renderFields(placeId = '7') {
  const onChange = vi.fn()
  render(<MemoryRouter>
    <PlaceRuleFields placeId={placeId} transition="enter" onChange={onChange} />
  </MemoryRouter>)
  return onChange
}

describe('Place rule continuation source trust', () => {
  beforeEach(() => {
    source.data = [{ id: 7, name: 'Complete retained place name', enabled: true }]
    source.error = null
    source.retry.mockClear()
  })

  it('keeps retained options usable and preserves IDs and transition values', () => {
    source.error = new Error('place refresh offline')
    const onChange = renderFields()
    const place = screen.getByRole('combobox', { name: 'Place' })
    expect(place).toBeEnabled()
    expect(place).toHaveValue('7')
    expect(screen.getByRole('option', { name: 'Complete retained place name' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(source.retry).toHaveBeenCalledOnce()
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('combobox', { name: 'When' }), { target: { value: 'exit' } })
    expect(onChange).toHaveBeenCalledWith('7', 'exit')
  })

  it('retains the unavailable saved ID rather than silently replacing it', () => {
    source.data = []
    renderFields('99')
    expect(screen.getByRole('combobox', { name: 'Place' })).toHaveValue('99')
    expect(screen.getByRole('option', { name: 'Place #99 (unavailable)' })).toBeInTheDocument()
    expect(screen.queryByText('No places configured')).not.toBeInTheDocument()
  })

  it('distinguishes fatal source failure from an empty catalogue and retries without editing', () => {
    source.data = undefined
    source.error = new Error('places unavailable')
    const onChange = renderFields()
    expect(screen.getByRole('combobox', { name: 'Place' })).toBeDisabled()
    expect(screen.queryByText('No places configured')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(source.retry).toHaveBeenCalledOnce()
    expect(onChange).not.toHaveBeenCalled()
  })
})
