/**
 * DensityApplier contract.
 *
 * DensityApplier is a headless side-effect carrier: it mounts
 * `useDensitySync()` so the user's `ui_density` setting is mirrored onto
 * `document.body.dataset.density`, and it renders nothing. These tests drive
 * the component through the REAL hook + `useSettings()` wiring (stubbing only
 * the network `request` so nothing hits an API) and assert the observable
 * effects rather than internals:
 *
 *   - it produces no DOM (a true headless carrier),
 *   - a resolved, valid server density is applied to <body> and persisted,
 *   - an unknown / missing density is ignored (bootstrap value preserved),
 *   - the still-loading state never clobbers the synchronously-bootstrapped
 *     value, and
 *   - it unmounts cleanly without tearing down the applied value.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, waitFor, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { DensityApplier } from './DensityApplier'

// The api-layer `useSettings()` that `useDensitySync()` consumes calls
// `request('/settings')`. Stub the client so the query resolves — or hangs,
// for the loading case — without touching the network. `nextSettings` and
// `hangForever` are mutated per test to steer the single `/settings` call.
let nextSettings: { ui_density?: string } = { ui_density: 'comfortable' }
let hangForever = false
vi.mock('@/api/client', () => ({
  request: vi.fn(() =>
    hangForever ? new Promise(() => {}) : Promise.resolve(nextSettings),
  ),
}))

function wrap(): (props: { children: ReactNode }) => JSX.Element {
  // A fresh QueryClient per render prevents `/settings` cache carryover
  // between tests, so every case re-runs the query against its own stub.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  return ({ children }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

describe('DensityApplier', () => {
  beforeEach(() => {
    // Emulate the synchronous main.tsx bootstrap: a known-good value is
    // already on <body> before React mounts, and storage is pristine.
    document.body.dataset.density = 'comfortable'
    localStorage.clear()
    nextSettings = { ui_density: 'comfortable' }
    hangForever = false
  })

  afterEach(() => {
    cleanup()
  })

  it('renders no DOM (headless side-effect carrier)', async () => {
    const { container } = render(<DensityApplier />, { wrapper: wrap() })

    expect(container.firstChild).toBeNull()
    expect(container.childNodes).toHaveLength(0)

    // Let the settings query settle so no state update leaks past the test.
    // With the default 'comfortable' stub the applied value equals the
    // bootstrap value, so <body> is unchanged.
    await waitFor(() =>
      expect(document.body.dataset.density).toBe('comfortable'),
    )
  })

  it('applies the resolved server density to <body> and persists it', async () => {
    nextSettings = { ui_density: 'spacious' }
    render(<DensityApplier />, { wrapper: wrap() })

    await waitFor(() =>
      expect(document.body.dataset.density).toBe('spacious'),
    )
    expect(localStorage.getItem('teslasync-density')).toBe('spacious')
  })

  it('applies a second valid value (behaviour is not hardcoded to one density)', async () => {
    nextSettings = { ui_density: 'compact' }
    render(<DensityApplier />, { wrapper: wrap() })

    await waitFor(() => expect(document.body.dataset.density).toBe('compact'))
    expect(localStorage.getItem('teslasync-density')).toBe('compact')
  })

  it('ignores an unknown server density and keeps the bootstrap value', async () => {
    nextSettings = { ui_density: 'ginormous' } // not one of the allowed values
    render(<DensityApplier />, { wrapper: wrap() })

    // Let the query resolve (flushing react-query's state update inside act);
    // the invalid value must be rejected by the hook's `isDensity` guard.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(document.body.dataset.density).toBe('comfortable')
    expect(localStorage.getItem('teslasync-density')).toBeNull()
  })

  it('ignores a missing ui_density and keeps the bootstrap value', async () => {
    nextSettings = {} // server returned settings without a density
    render(<DensityApplier />, { wrapper: wrap() })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(document.body.dataset.density).toBe('comfortable')
    expect(localStorage.getItem('teslasync-density')).toBeNull()
  })

  it('does not clobber the bootstrap value while settings are still loading', async () => {
    document.body.dataset.density = 'spacious' // synchronously bootstrapped
    hangForever = true // /settings never resolves — query stays pending
    render(<DensityApplier />, { wrapper: wrap() })

    await new Promise((r) => setTimeout(r, 30))
    // The effect is guarded on `isSuccess`, so a pending query must be a
    // no-op: the bootstrap value survives and nothing is persisted.
    expect(document.body.dataset.density).toBe('spacious')
    expect(localStorage.getItem('teslasync-density')).toBeNull()
  })

  it('unmounts cleanly and leaves the applied value in place', async () => {
    nextSettings = { ui_density: 'compact' }
    const { unmount } = render(<DensityApplier />, { wrapper: wrap() })

    await waitFor(() => expect(document.body.dataset.density).toBe('compact'))

    expect(() => unmount()).not.toThrow()
    // Unmounting the carrier must not revert the density it applied.
    expect(document.body.dataset.density).toBe('compact')
  })
})
