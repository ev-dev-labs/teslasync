import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { getCurrentDensity, useDensitySync } from '../useDensitySync'

// Stub the API client so useSettings() resolves without network.
let nextSettings: { ui_density?: string } = { ui_density: 'comfortable' }
vi.mock('@/api/client', () => ({
  request: vi.fn(async () => nextSettings),
}))

function wrap(): (props: { children: ReactNode }) => JSX.Element {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  return ({ children }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

describe('useDensitySync', () => {
  beforeEach(() => {
    document.body.dataset.density = 'comfortable'
    localStorage.clear()
  })

  it('exposes the current bootstrapped density via getCurrentDensity', () => {
    document.body.dataset.density = 'spacious'
    expect(getCurrentDensity()).toBe('spacious')
  })

  it('falls back to comfortable when body data attr is missing/invalid', () => {
    delete document.body.dataset.density
    expect(getCurrentDensity()).toBe('comfortable')
    document.body.dataset.density = 'huge' // not a valid value
    expect(getCurrentDensity()).toBe('comfortable')
  })

  it('writes body data attribute and localStorage when settings query resolves', async () => {
    nextSettings = { ui_density: 'compact' }
    renderHook(() => useDensitySync(), { wrapper: wrap() })

    await waitFor(() => {
      expect(document.body.dataset.density).toBe('compact')
    })
    expect(localStorage.getItem('teslasync-density')).toBe('compact')
  })

  it('ignores unknown density values from the server', async () => {
    document.body.dataset.density = 'comfortable'
    nextSettings = { ui_density: 'enormous' }
    renderHook(() => useDensitySync(), { wrapper: wrap() })

    // give the query a tick to resolve; value should remain 'comfortable'
    await new Promise((r) => setTimeout(r, 30))
    expect(document.body.dataset.density).toBe('comfortable')
    expect(localStorage.getItem('teslasync-density')).toBeNull()
  })
})
