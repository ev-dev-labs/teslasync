/**
 * FleetComparisonPanel — behavioural tests.
 *
 * The panel converts SI fleet rollups (distance in km, efficiency in Wh/km) to
 * the user's display units at the render boundary and owns its own
 * loading / error / empty / populated states. These tests exercise:
 *   - km rendering + descending-by-distance sort,
 *   - the mi branch (distance + Wh/mi efficiency rescale + swapped labels),
 *   - loading (busy skeleton, shell still visible, no list),
 *   - error (QueryError retry wired to onRetry),
 *   - empty (placeholder, no list),
 *   - null/NaN safety (bad rollups coerced to 0, sort not scrambled),
 *   - the blank / whitespace-name fallback,
 *   - a11y (decorative header icon + accessible list name).
 *
 * `useUnits` / `useChartPalette` are mocked via `vi.hoisted` so a single file
 * can flip km <-> mi deterministically without a QueryClient / SettingsProvider,
 * and `react-i18next` is stubbed to a passthrough `t(key, default)`. Renders are wrapped in
 * <MemoryRouter> because the real QueryError / EmptyState reach for
 * react-router navigation hooks. No network is touched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import {
  FleetComparisonPanel,
  type FleetComparisonPanelProps,
} from './FleetComparisonPanel'
import type { VehicleComparisonEntry } from '@/types/analytics'

// Mutable, hoisted display-preference state so each test can flip the unit
// system before rendering. `vi.hoisted` guarantees it is initialised before
// the `vi.mock` factories below (which are themselves hoisted above imports).
const hoisted = vi.hoisted(() => ({
  distance: 'km' as 'km' | 'mi',
  palette: ['#111111', '#222222', '#333333'] as readonly string[],
}))

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: hoisted.distance } }),
}))

vi.mock('@/hooks/useChartPalette', () => ({
  useChartPalette: () => hoisted.palette,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string | object) =>
      typeof defaultValue === 'string' ? defaultValue : key,
  }),
}))

function makeEntry(over: Partial<VehicleComparisonEntry> = {}): VehicleComparisonEntry {
  return { id: 'v', name: 'Vehicle', distance: 0, energy: 0, efficiency: 0, ...over }
}

function renderPanel(props: Partial<FleetComparisonPanelProps> = {}) {
  const merged: FleetComparisonPanelProps = {
    entries: [],
    loading: false,
    error: null,
    ...props,
  }
  return render(
    <MemoryRouter>
      <FleetComparisonPanel {...merged} />
    </MemoryRouter>,
  )
}

describe('FleetComparisonPanel', () => {
  beforeEach(() => {
    hoisted.distance = 'km'
  })

  afterEach(() => {
    cleanup()
  })

  it('renders one row per vehicle sorted by distance (desc) with km + Wh/km labels', () => {
    renderPanel({
      entries: [
        makeEntry({ id: 'a', name: 'Alpha', distance: 50, efficiency: 140 }),
        makeEntry({ id: 'b', name: 'Bravo', distance: 200, efficiency: 160 }),
        makeEntry({ id: 'c', name: 'Charlie', distance: 120, efficiency: 150 }),
      ],
    })

    const list = screen.getByRole('list', { name: /fleet comparison/i })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    // Descending by distance: Bravo (200) > Charlie (120) > Alpha (50).
    expect(items[0]).toHaveTextContent('Bravo')
    expect(items[1]).toHaveTextContent('Charlie')
    expect(items[2]).toHaveTextContent('Alpha')
    // km is the identity conversion; efficiency is rendered at precision 2.
    expect(items[0]).toHaveTextContent('200 km · 160.00 Wh/km')
  })

  it('converts distance and efficiency and swaps unit labels when the user prefers miles', () => {
    hoisted.distance = 'mi'
    renderPanel({
      entries: [makeEntry({ id: 'a', name: 'Alpha', distance: 100, efficiency: 150 })],
    })

    const item = screen.getByRole('listitem')
    // 100 km -> 62 mi (100000 / 1609.344); 150 Wh/km -> 241.40 Wh/mi (x1.609344).
    expect(item).toHaveTextContent('62 mi · 241.40 Wh/mi')
    expect(item).not.toHaveTextContent('km')
  })

  it('shows a busy skeleton (no list) while loading but keeps the panel shell', () => {
    const { container } = renderPanel({
      loading: true,
      entries: [makeEntry({ id: 'a', name: 'Alpha', distance: 10 })],
    })

    // Panel title (shell) is always present — never a blank panel.
    expect(screen.getByText(/fleet comparison/i)).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).toBeTruthy()
    // The panel announces its busy state to assistive tech.
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('renders QueryError and invokes onRetry when the retry control is used', () => {
    const onRetry = vi.fn()
    renderPanel({ error: new Error('boom'), onRetry })

    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    const retry = screen.getByRole('button', { name: /retry/i })

    fireEvent.click(retry)

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('shows the empty placeholder (no list) when there are no vehicles', () => {
    renderPanel({ entries: [] })

    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(
      screen.getByText('No fleet comparison data yet'),
    ).toBeInTheDocument()
  })

  it('coerces null / undefined / NaN rollups to 0 and keeps them below real distances in the sort', () => {
    renderPanel({
      entries: [
        // NaN distance is the ordering trap: with `?? 0` it slips through and
        // scrambles the comparator; `safeNumber` pins it to 0.
        makeEntry({ id: 'bad', name: 'Bad', distance: NaN, efficiency: null as unknown as number }),
        makeEntry({ id: 'good', name: 'Good', distance: 100, efficiency: 150 }),
      ],
    })

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    // 100 km real distance must outrank the coerced-to-0 bad rollup.
    expect(items[0]).toHaveTextContent('Good')
    expect(items[1]).toHaveTextContent('Bad')
    expect(items[1]).toHaveTextContent('0 km · 0.00 Wh/km')
  })

  it('falls back to "Unnamed" for blank and whitespace-only vehicle names', () => {
    renderPanel({
      entries: [makeEntry({ id: 'ws', name: '   ', distance: 10, efficiency: 100 })],
    })
    expect(screen.getByRole('listitem')).toHaveTextContent('Unnamed')
  })

  it('marks the header icon decorative and gives the list an accessible name', () => {
    const { container } = renderPanel({
      entries: [makeEntry({ id: 'a', name: 'Alpha', distance: 10, efficiency: 100 })],
    })
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeTruthy()
    expect(
      screen.getByRole('list', { name: /fleet comparison/i }),
    ).toBeInTheDocument()
  })
})
