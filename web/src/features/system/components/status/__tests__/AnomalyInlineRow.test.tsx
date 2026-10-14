import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { DataStateSource } from '@/api/dataState'
import type { AnomalyData } from '@/api/hooks/useAnomalies'
import { request } from '@/api/client'
import { AnomalyInlineRow } from '../AnomalyInlineRow'

const vehiclesQuery: DataStateSource<Array<{ id: number }>> = {}
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => vehiclesQuery,
}))
vi.mock('@/api/client', () => ({ request: vi.fn() }))

const empty: AnomalyData = {
  anomalies: [], anomalies_last_24h: 0, anomalies_last_7d: 0,
  health_summary: {}, signals_monitored: 5,
}
const populated: AnomalyData = {
  ...empty, anomalies_last_24h: 1, anomalies_last_7d: 1,
  anomalies: [{
    signal: 'battery_voltage', type: 'z_score', severity: 'warning',
    value: 14.2, baseline: 12.5, z_score: 4.3,
    detected_at: new Date(Date.now() - 12 * 60_000).toISOString(),
    message: 'unusual reading',
  }],
}
const key = ['system-status', 'anomalies-summary', '7']
const clients: QueryClient[] = []

function renderRow() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  clients.push(client)
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter><AnomalyInlineRow /></MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...view, client }
}

describe('AnomalyInlineRow', () => {
  beforeEach(() => {
    vi.mocked(request).mockReset()
    Object.assign(vehiclesQuery, {
      data: [{ id: 7 }], isSuccess: true, isError: false,
      isLoading: false, isFetching: false, fetchStatus: 'idle',
      error: null, dataUpdatedAt: Date.now(), refetch: vi.fn(),
    })
    onlineManager.setOnline(true)
  })
  afterEach(() => {
    cleanup()
    clients.splice(0).forEach((client) => client.clear())
    onlineManager.setOnline(true)
  })

  it('suppresses a successfully confirmed empty vehicle list without querying anomalies', () => {
    vehiclesQuery.data = []
    const { container } = renderRow()
    expect(container).toBeEmptyDOMElement()
    expect(request).not.toHaveBeenCalled()
  })

  it('keeps a loading vehicle source visible instead of inferring an empty fleet', () => {
    Object.assign(vehiclesQuery, { data: undefined, isSuccess: false, isLoading: true, isFetching: true })
    renderRow()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Anomalies/ })).toHaveAttribute('href', '/anomaly-detection')
    expect(request).not.toHaveBeenCalled()
  })

  it('shows active anomaly loading and preserves request scope and cancellation', async () => {
    vi.mocked(request).mockImplementation(() => new Promise(() => {}))
    const { container } = renderRow()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    await waitFor(() => expect(request).toHaveBeenCalledWith(
      '/analytics/anomalies?vehicle_id=7&days=1', { signal: expect.any(AbortSignal) },
    ))
  })

  it('shows paused vehicle discovery as unknown with an enabled recovery control', () => {
    Object.assign(vehiclesQuery, {
      data: undefined, isSuccess: false, fetchStatus: 'paused',
      isLoading: false, isFetching: false,
    })
    renderRow()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(vehiclesQuery.refetch).toHaveBeenCalledOnce()
    expect(request).not.toHaveBeenCalled()
  })

  it('shows paused-without-data as unknown with an enabled refresh, then recovers', async () => {
    onlineManager.setOnline(false)
    vi.mocked(request).mockResolvedValue(populated)
    const { container } = renderRow()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
    expect(request).not.toHaveBeenCalled()
    act(() => onlineManager.setOnline(true))
    expect(await screen.findByText(/1 in 24h/)).toBeInTheDocument()
  })

  it.each([
    ['zero count', { ...populated, anomalies_last_24h: 0 }],
    ['empty entries', { ...empty, anomalies_last_24h: 1 }],
  ])('suppresses successfully confirmed %s', async (_, data) => {
    vi.mocked(request).mockResolvedValue(data)
    const { container, client } = renderRow()
    await waitFor(() => expect(client.getQueryState(key)?.status).toBe('success'))
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('renders anomaly severity and the existing click-through', async () => {
    vi.mocked(request).mockResolvedValue(populated)
    renderRow()
    expect(await screen.findByText(/1 in 24h/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Anomalies/ })).toHaveAttribute('href', '/anomaly-detection')
  })

  it('shows an initial failure with enabled retry and recovers to confirmed absence', async () => {
    vi.mocked(request).mockRejectedValueOnce(new Error('Anomaly service failed')).mockResolvedValue(empty)
    const { container } = renderRow()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: /retry/i })
    expect(retry).toBeEnabled()
    fireEvent.click(retry)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it.each([
    ['populated', populated],
    ['zero', empty],
    ['empty', { ...empty, anomalies_last_24h: 1 }],
  ])('retains %s evidence on refresh failure and recovers through its refresh control', async (_, data) => {
    vi.mocked(request).mockResolvedValueOnce(data)
      .mockRejectedValueOnce(new Error('Refresh failed')).mockResolvedValueOnce(empty)
    const { container, client } = renderRow()
    await waitFor(() => expect(client.getQueryState(key)?.status).toBe('success'))
    await act(async () => { await client.refetchQueries({ queryKey: key }) })
    expect(await screen.findByTestId('stale-refresh-warning')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Anomalies/ })).toBeInTheDocument()
    expect(client.getQueryData(key)).toEqual(data)
    if (data === populated) expect(screen.getByText(/1 in 24h/)).toBeInTheDocument()
    else expect(screen.getByText('Unknown')).toBeInTheDocument()
    const refresh = screen.getByRole('button', { name: 'Refresh' })
    expect(refresh).toBeEnabled()
    fireEvent.click(refresh)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('does not suppress retained empty vehicles after a refresh failure', () => {
    Object.assign(vehiclesQuery, { data: [], isSuccess: false, isError: true, error: new Error('Vehicle refresh failed') })
    renderRow()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument()
    const refresh = screen.getByRole('button', { name: 'Refresh' })
    expect(refresh).toBeEnabled()
    fireEvent.click(refresh)
    expect(vehiclesQuery.refetch).toHaveBeenCalledOnce()
    expect(request).not.toHaveBeenCalled()
  })

  it('keeps retained absence visible while its refresh is paused', async () => {
    vi.mocked(request).mockResolvedValue(empty)
    const { client } = renderRow()
    await waitFor(() => expect(client.getQueryState(key)?.status).toBe('success'))
    act(() => {
      onlineManager.setOnline(false)
      void client.refetchQueries({ queryKey: key })
    })
    expect(await screen.findByText('Unknown')).toBeInTheDocument()
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true')
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    act(() => onlineManager.setOnline(true))
    await waitFor(() => expect(screen.queryByText('Anomalies')).not.toBeInTheDocument())
  })
})
