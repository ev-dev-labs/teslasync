import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useCachedOnboardingEvidence } from './useCachedOnboardingEvidence'

afterEach(() => {
  vi.restoreAllMocks()
})

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

function QueryCreatingPage() {
  useQuery({
    queryKey: ['automations'],
    queryFn: async () => [],
    initialData: [],
    enabled: false,
  })
  return null
}

describe('useCachedOnboardingEvidence subscription', () => {
  it('keeps unknown evidence stable when pending and unrelated queries are created', () => {
    const { client, wrapper } = setup()
    const { result, rerender } = renderHook(useCachedOnboardingEvidence, { wrapper })
    const unknown = result.current

    act(() => {
      client.getQueryCache().build(client, { queryKey: ['drives', 'pending-window'] })
      client.setQueryData(['system-health'], { status: 'healthy' })
    })
    rerender()

    expect(result.current).toBe(unknown)
    expect(result.current.driveCount).toBeUndefined()
  })

  it('retains the snapshot when cache updates do not change decoded evidence', () => {
    const { client, wrapper } = setup()
    client.setQueryData(['automations'], [{ id: 1 }])
    const { result, rerender } = renderHook(useCachedOnboardingEvidence, { wrapper })
    const observed = result.current

    act(() => {
      client.setQueryData(['automations'], [{ id: 2 }])
      client.getQueryCache().build(client, { queryKey: ['drives', 'another-pending-window'] })
    })
    rerender()

    expect(result.current).toBe(observed)
    expect(result.current.automationCount).toBe(1)
  })

  it('observes a query created during another page render without updating that render', async () => {
    const errors = vi.spyOn(console, 'error')
    const { client } = setup()
    let showPage = false
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        {children}
        {showPage && <QueryCreatingPage />}
      </QueryClientProvider>
    )
    const { result, rerender } = renderHook(useCachedOnboardingEvidence, { wrapper })
    expect(result.current.automationCount).toBeUndefined()

    showPage = true
    rerender()

    await waitFor(() => expect(result.current.automationCount).toBe(0))
    expect(
      errors.mock.calls.filter((args) =>
        args.some((arg) => typeof arg === 'string' && arg.includes('Cannot update a component')),
      ),
    ).toHaveLength(0)
  })

  it('keeps resolved evidence reactive through updates and removal', async () => {
    const { client, wrapper } = setup()
    const { result } = renderHook(useCachedOnboardingEvidence, { wrapper })

    act(() => {
      client.setQueryData(['automations'], [])
    })
    await waitFor(() => expect(result.current.automationCount).toBe(0))

    act(() => {
      client.setQueryData(['automations'], [{ id: 1 }])
    })
    await waitFor(() => expect(result.current.automationCount).toBe(1))

    act(() => {
      client.removeQueries({ queryKey: ['automations'] })
    })
    await waitFor(() => expect(result.current.automationCount).toBeUndefined())
  })
})
