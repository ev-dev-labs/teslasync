import { describe, expect, it, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useFleetTelemetryCoverage } from '../useFleetTelemetry'

const requestMock = vi.fn()
vi.mock('../../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}))

function makeWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useFleetTelemetryCoverage', () => {
  beforeEach(() => requestMock.mockReset())

  it('hits /tesla/fleet-telemetry/coverage without the /api/v1 prefix', async () => {
    requestMock.mockResolvedValue({
      categories: [
        {
          category: 'driving',
          total_fields: 1,
          destinations: { signal_log: 1 },
          fields: [
            {
              field: 'VehicleSpeed',
              destination: 'signal_log',
              column: '',
              also_signal_log: false,
              subscribed: true,
            },
          ],
        },
      ],
      destination_totals: { signal_log: 1 },
      orphan_fields: [],
    })

    const { result } = renderHook(() => useFleetTelemetryCoverage(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(requestMock).toHaveBeenCalledWith(
      '/tesla/fleet-telemetry/coverage',
      expect.objectContaining({ signal: expect.any(Object) }),
    )
    expect(result.current.data?.categories?.[0]?.fields?.[0]?.field).toBe('VehicleSpeed')
    expect(result.current.data?.destination_totals?.signal_log).toBe(1)
  })

  it('defaults orphan_fields to an empty array when the server omits it', async () => {
    requestMock.mockResolvedValue({
      categories: [],
      destination_totals: {},
    })
    const { result } = renderHook(() => useFleetTelemetryCoverage(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.orphan_fields).toEqual([])
  })
})
