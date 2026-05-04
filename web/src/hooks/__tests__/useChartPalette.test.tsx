import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { CHART_COLORS_CB_SAFE, CHART_COLORS_NEON } from '@/lib/colors'

// Stub the API client so useSettings() resolves without network.
let nextSettings: { chart_palette?: string } = {}
vi.mock('@/api/client', () => ({
  request: vi.fn(async () => nextSettings),
}))

import {
  useChartPalette,
  resolveChartPalette,
  CHART_PALETTES,
} from '../useChartPalette'

function wrap(): (props: { children: ReactNode }) => JSX.Element {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  return ({ children }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

describe('resolveChartPalette (pure)', () => {
  it('returns CB-safe for undefined', () => {
    expect(resolveChartPalette(undefined)).toBe(CHART_COLORS_CB_SAFE)
  })

  it('returns CB-safe for null', () => {
    expect(resolveChartPalette(null)).toBe(CHART_COLORS_CB_SAFE)
  })

  it('returns CB-safe for explicit "cb_safe"', () => {
    expect(resolveChartPalette('cb_safe')).toBe(CHART_COLORS_CB_SAFE)
  })

  it('returns neon for explicit "neon"', () => {
    expect(resolveChartPalette('neon')).toBe(CHART_COLORS_NEON)
  })

  it('falls back to CB-safe for unknown values', () => {
    expect(resolveChartPalette('rainbow')).toBe(CHART_COLORS_CB_SAFE)
    expect(resolveChartPalette('')).toBe(CHART_COLORS_CB_SAFE)
  })
})

describe('CHART_PALETTES', () => {
  it('exposes both built-in palettes by id', () => {
    expect(CHART_PALETTES.cb_safe).toBe(CHART_COLORS_CB_SAFE)
    expect(CHART_PALETTES.neon).toBe(CHART_COLORS_NEON)
  })
})

describe('useChartPalette (hook)', () => {
  beforeEach(() => {
    nextSettings = {}
  })

  it('returns CB-safe palette by default when settings have not loaded', () => {
    const { result } = renderHook(() => useChartPalette(), { wrapper: wrap() })
    // Initial render — settings query has not resolved yet, so we get the fallback.
    expect(result.current).toBe(CHART_COLORS_CB_SAFE)
  })

  it('returns CB-safe palette when chart_palette is "cb_safe"', async () => {
    nextSettings = { chart_palette: 'cb_safe' }
    const { result } = renderHook(() => useChartPalette(), { wrapper: wrap() })
    await waitFor(() => {
      expect(result.current).toBe(CHART_COLORS_CB_SAFE)
    })
  })

  it('returns neon palette when chart_palette is "neon"', async () => {
    nextSettings = { chart_palette: 'neon' }
    const { result } = renderHook(() => useChartPalette(), { wrapper: wrap() })
    await waitFor(() => {
      expect(result.current).toBe(CHART_COLORS_NEON)
    })
  })

  it('falls back to CB-safe for unknown server values', async () => {
    nextSettings = { chart_palette: 'rainbow' }
    const { result } = renderHook(() => useChartPalette(), { wrapper: wrap() })
    // The query resolves but the value is not one of the known palettes —
    // resolveChartPalette() must coerce it back to the CB-safe default.
    await waitFor(() => {
      expect(result.current).toBe(CHART_COLORS_CB_SAFE)
    })
  })

  it('returns at least 6 hex colors regardless of setting', async () => {
    nextSettings = { chart_palette: 'neon' }
    const { result } = renderHook(() => useChartPalette(), { wrapper: wrap() })
    await waitFor(() => {
      expect(result.current.length).toBeGreaterThanOrEqual(6)
      result.current.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/i))
    })
  })
})
