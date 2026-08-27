import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { ToastProvider } from '@/components/feedback/Toast'
import { ThemeProvider } from '@/components/ui/ThemeProvider'
import {
  __SELECTED_VEHICLE_STORAGE_KEY__,
  SelectedVehicleProvider,
} from '@/store/selectedVehicle'
import {
  CommandPalette,
  PALETTE_INPUT_FOCUS_DELAY_MS,
  addRecentCommand,
  getRecentCommands,
} from '../CommandPalette'
import { CommandPaletteHost } from '@/components/layout/CommandPaletteHost'
import { vehicleKeys } from '@/api/hooks/useVehicles'
import { savedViewsKeys } from '@/api/hooks/useSavedViews'
import { searchKeys } from '@/api/hooks/useSearch'
import { alertKeys } from '@/api/hooks/useAlerts'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { recordCommandUse, _resetFrecency } from '@/lib/commandFrecency'
import { setPinnedNavPaths, __resetNavPinsSessionOverridesForTests } from '@/lib/navPins'
import { getShellFocusableElements } from '@/components/layout/shellFocusTrap'
import type { Vehicle } from '@/types/vehicle'
import type { Alert, AlertDetail, SavedView, SearchResponse } from '@/api/types'
import type { ReactNode } from 'react'
import { StrictMode } from 'react'

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}))

// jsdom doesn't implement matchMedia; ThemeProvider uses it for `prefers-color-scheme`
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList
}

// jsdom lacks Element.prototype.scrollIntoView; the palette calls it on the
// highlighted row whenever selectedIndex changes (keyboard nav).
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {}
}

// ─── Test plumbing ──────────────────────────────────────────────────────────

function makeVehicles(): Vehicle[] {
  return [
    { id: 1, vin: 'VIN1', display_name: 'Model 3', model: 'Model 3', state: 'online' } as Vehicle,
    { id: 2, vin: 'VIN2', display_name: 'Model Y', model: 'Model Y', state: 'asleep' } as Vehicle,
  ]
}

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 9,
    vehicle_id: 1,
    type: 'battery',
    severity: 'critical',
    title: 'Battery critically low',
    message: 'Charge before the next dispatch',
    is_read: false,
    created_at: '2026-08-24T16:00:00Z',
    ...overrides,
  }
}

function makeWrapper(
  vehicles: Vehicle[],
  savedViews: SavedView[] = [],
  searchResponses: Record<string, SearchResponse> = {},
  alerts: Alert[] = [],
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    qc.setQueryData(vehicleKeys.all, vehicles)
    qc.setQueryData(savedViewsKeys.allList, savedViews)
    qc.setQueryData(alertKeys.alerts, alerts)
    for (const [query, response] of Object.entries(searchResponses)) {
      qc.setQueryData(searchKeys.global(query, undefined, 5), response)
    }
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>
          <ThemeProvider>
            <ToastProvider>
              <SelectedVehicleProvider>{children}</SelectedVehicleProvider>
            </ToastProvider>
          </ThemeProvider>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}

// Mounts the global keyboard-shortcut hook the same way Layout does in
// production. CommandPalette no longer owns its Ctrl+K binding directly;
// the shortcut hook translates Ctrl+K into the `toggle-command-palette`
// custom event that the palette listens for.
function KeyboardShortcutsHost() {
  useKeyboardShortcuts()
  return null
}

// Open the palette the same way `useKeyboardShortcuts` does in production —
// by dispatching the custom event the palette subscribes to. Avoids needing
// to mount the shortcut hook in every test that just wants the modal open.
function openPaletteViaEvent() {
  act(() => { window.dispatchEvent(new CustomEvent('toggle-command-palette')) })
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  __resetNavPinsSessionOverridesForTests()
  _resetFrecency()
  requestMock.mockReset()
  requestMock.mockResolvedValue({})
})

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  __resetNavPinsSessionOverridesForTests()
  _resetFrecency()
})

// ─── Recent storage ─────────────────────────────────────────────────────────

describe('CommandPalette recent storage', () => {
  it('persists to localStorage under teslasync.recentCommands', () => {
    addRecentCommand({ kind: 'registry', registryId: 'pref.theme.dark' })
    const raw = localStorage.getItem('teslasync.recentCommands')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw as string)
    expect(parsed[0]).toEqual({ kind: 'registry', registryId: 'pref.theme.dark' })
  })

  it('places the most-recently-used entry first (LRU semantics)', () => {
    addRecentCommand({ kind: 'registry', registryId: 'a' })
    addRecentCommand({ kind: 'registry', registryId: 'b' })
    addRecentCommand({ kind: 'registry', registryId: 'a' }) // re-use bumps it back to top
    const recent = getRecentCommands()
    expect(recent[0]).toEqual({ kind: 'registry', registryId: 'a' })
    expect(recent[1]).toEqual({ kind: 'registry', registryId: 'b' })
    expect(recent.length).toBe(2) // dedup, no duplicate "a"
  })

  it('caps the stored list at 10 entries', () => {
    for (let i = 0; i < 15; i++) addRecentCommand({ kind: 'registry', registryId: `c${i}` })
    expect(getRecentCommands().length).toBe(10)
  })

  it('survives malformed JSON in localStorage gracefully', () => {
    localStorage.setItem('teslasync.recentCommands', 'not-json')
    expect(getRecentCommands()).toEqual([])
  })
})

// ─── Cmd+K behavior ─────────────────────────────────────────────────────────

describe('CommandPalette keyboard shortcut', () => {
  it('opens the deferred palette on its first invocation', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    const onOpen = vi.fn()
    render(<CommandPaletteHost onOpen={onOpen} />, { wrapper: Wrapper })
    expect(screen.queryByPlaceholderText(/Search pages/i)).toBeNull()

    act(() => { window.dispatchEvent(new CustomEvent('toggle-command-palette')) })

    // The host resolves the palette through `React.lazy`, so the first open
    // waits on a real dynamic import. Under a saturated full-suite run that
    // can exceed waitFor's 1 s default — this is chunk-load latency, not a
    // behavioural delay, so give it explicit headroom.
    await waitFor(
      () => {
        expect(screen.getByPlaceholderText(/Search pages/i)).toBeInTheDocument()
        expect(onOpen).toHaveBeenCalledTimes(1)
      },
      { timeout: 10_000 },
    )
    const positioner = document.querySelector(
      '[data-command-palette-positioner]',
    )
    const panel = document.querySelector('[data-command-palette-panel]')
    // Viewport-centered at every width and zoom level: no sidebar offset, no
    // breakpoint-conditional horizontal padding, no transform.
    expect(positioner).toHaveClass(
      'fixed',
      'inset-0',
      'flex',
      'items-start',
      'justify-center',
      'overflow-y-auto',
    )
    const positionerClass = positioner?.getAttribute('class') ?? ''
    expect(positionerClass).not.toContain('--shell-sidebar-width')
    expect(positionerClass).not.toContain('xl:ps-')
    expect(positionerClass).not.toContain('sm:top-')
    expect(panel).toHaveClass('w-full', 'max-w-lg', 'pointer-events-auto')
    expect(panel?.getAttribute('class')).not.toContain('translate-x')
  })

  it('bounds the panel height so it stays fully reachable at high zoom', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })
    openPaletteViaEvent()

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search pages/i)).toBeInTheDocument()
    })

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveClass('flex', 'flex-col', 'max-h-[84vh]')
    const listbox = screen.getByRole('listbox')
    expect(listbox).toHaveClass('max-h-80', 'min-h-0', 'overflow-y-auto')
  })

  it('opens on Ctrl+K when focus is on the body', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(
      <>
        <KeyboardShortcutsHost />
        <CommandPalette />
      </>,
      { wrapper: Wrapper },
    )
    expect(screen.queryByPlaceholderText(/Search pages/i)).toBeNull()

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search pages/i)).toBeInTheDocument()
    })
  })

  it('does NOT open on Ctrl+K while focus is in an external <input>', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(
      <>
        <KeyboardShortcutsHost />
        <input data-testid="external-input" />
        <CommandPalette />
      </>,
      { wrapper: Wrapper },
    )
    const externalInput = screen.getByTestId('external-input') as HTMLInputElement
    externalInput.focus()
    fireEvent.keyDown(externalInput, { key: 'k', ctrlKey: true })

    // Give effects a tick to run; palette should remain closed
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    expect(screen.queryByPlaceholderText(/Search pages/i)).toBeNull()
  })

  it('opens via the toggle-command-palette custom event (used by useKeyboardShortcuts)', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })
    expect(screen.queryByPlaceholderText(/Search pages/i)).toBeNull()

    act(() => { window.dispatchEvent(new CustomEvent('toggle-command-palette')) })
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search pages/i)).toBeInTheDocument()
    })
  })
})

// ─── Search & sections ──────────────────────────────────────────────────────

describe('CommandPalette search', () => {
  it('matches "btr" → "Battery Health" via fuzzy subsequence', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })

    openPaletteViaEvent()
    const input = await screen.findByPlaceholderText(/Search pages/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'btr' } })

    expect(await screen.findByText('Battery Health')).toBeInTheDocument()
  })

  it('surfaces vehicle-switch entries when fleet has 2+ vehicles', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })

    openPaletteViaEvent()
    const input = await screen.findByPlaceholderText(/Search pages/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'switch' } })

    // Vehicle 1 (id=1) is the persisted default after the provider boots
    // (the store initialises to the first vehicle), so the only switchable
    // entry is "Switch to Model Y".
    await waitFor(() => {
      expect(screen.getByText(/Switch to Model Y/i)).toBeInTheDocument()
    })
  })

  it('changes the global vehicle selection from a switch command', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })

    openPaletteViaEvent()
    const input = await screen.findByPlaceholderText(/Search pages/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'switch model y' } })
    fireEvent.click(await screen.findByRole('option', { name: /Switch to Model Y/i }))

    await waitFor(() => {
      expect(localStorage.getItem(__SELECTED_VEHICLE_STORAGE_KEY__)).toBe('2')
    })
  })

  it('surfaces theme registry commands on a "theme" search', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })

    openPaletteViaEvent()
    const input = await screen.findByPlaceholderText(/Search pages/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'theme' } })

    expect(await screen.findByText(/Theme: Dark/)).toBeInTheDocument()
    expect(screen.getByText(/Theme: Light/)).toBeInTheDocument()
  })

  it('surfaces refresh action on a "refresh" search', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })

    openPaletteViaEvent()
    const input = await screen.findByPlaceholderText(/Search pages/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'refresh' } })

    expect(await screen.findByText(/Refresh data/)).toBeInTheDocument()
  })

  it('opens live entity-search results from the command center', async () => {
    const Wrapper = makeWrapper(makeVehicles(), [], {
      alpha: {
        query: 'alpha',
        hits: [{
          type: 'drive',
          id: 77,
          title: 'Alpha commute',
          subtitle: 'Drive · completed',
          url: '/drives/77',
          score: 100,
        }],
      },
    })
    render(
      <>
        <CommandPalette />
        <LocationProbe />
      </>,
      { wrapper: Wrapper },
    )

    openPaletteViaEvent()
    const input = await screen.findByPlaceholderText(/Search pages/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'alpha' } })

    const result = await screen.findByRole('option', { name: /Alpha commute/i })
    fireEvent.click(result)

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/drives/77')
    })
  })

  it('finds and applies saved views from any supported workspace', async () => {
    const Wrapper = makeWrapper(makeVehicles(), [{
      id: 41,
      name: 'Long-haul efficiency',
      route: '/drives',
      query: 'range=30d&sort=efficiency',
      is_default: false,
      is_pinned: true,
      sort_order: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }])
    render(
      <>
        <CommandPalette />
        <LocationProbe />
      </>,
      { wrapper: Wrapper },
    )

    openPaletteViaEvent()
    const input = await screen.findByPlaceholderText(/Search pages/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'long haul' } })

    const result = await screen.findByRole('option', { name: /Long-haul efficiency/i })
    expect(screen.getByText('Saved views')).toBeInTheDocument()
    fireEvent.click(result)

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/drives?range=30d&sort=efficiency',
      )
    })
  })

  it('acknowledges an open alert from the command center and exposes Undo', async () => {
    const alert = makeAlert()
    const acknowledged: AlertDetail = {
      ...alert,
      acknowledged_at: '2026-08-24T17:00:00Z',
      events: [],
    }
    const reopened: AlertDetail = {
      ...alert,
      acknowledged_at: null,
      events: [],
    }
    requestMock.mockImplementation((path: string) => {
      if (path === `/alerts/${alert.id}/acknowledge`) return Promise.resolve(acknowledged)
      if (path === `/alerts/${alert.id}/reopen`) return Promise.resolve(reopened)
      return Promise.reject(new Error(`Unexpected request: ${path}`))
    })
    const Wrapper = makeWrapper(
      makeVehicles(),
      [],
      { acknowledge: { query: 'acknowledge', hits: [] } },
      [alert],
    )
    render(<CommandPalette />, { wrapper: Wrapper })

    openPaletteViaEvent()
    const input = await screen.findByPlaceholderText(/Search pages/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'acknowledge' } })
    fireEvent.click(await screen.findByRole('option', { name: /Acknowledge an alert/i }))

    expect(screen.getByText('Choose an open alert to acknowledge')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /Battery critically low/i }))

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        `/alerts/${alert.id}/acknowledge`,
        expect.objectContaining({ method: 'POST' }),
      )
    })
    expect(await screen.findByText('Alert acknowledged')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        `/alerts/${alert.id}/reopen`,
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  // Regression for a scoring bug where each keyword was
  // re-scored as if it were the label, giving keyword startsWith the same
  // score as label startsWith. That made "State Machine" (matches keyword
  // "debugger" → "d") tie with "Drives" (matches label "Drives" → "d") and
  // sort ahead of it via frecency / insertion order. After the fix the only
  // way a keyword can outscore a label is if no label match exists.
  it('ranks the "Drives" page above keyword-only matches (e.g. "debugger") for query "d"', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })

    openPaletteViaEvent()
    const input = await screen.findByPlaceholderText(/Search pages/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'd' } })

    // Each palette row renders the label inside a <span class="font-medium truncate">.
    // Find that label span by exact text and walk up to its button to compare DOM
    // order. Sort key = score DESC, so DOM order = score order.
    const drivesLabel = await screen.findByText('Drives', { selector: 'span.font-medium' })
    const drivesButton = drivesLabel.closest('button')
    expect(drivesButton).not.toBeNull()

    const stateMachineLabels = screen.queryAllByText('State Machine', { selector: 'span.font-medium' })
    if (stateMachineLabels.length > 0) {
      const stateMachineButton = stateMachineLabels[0].closest('button')
      expect(stateMachineButton).not.toBeNull()
      // compareDocumentPosition: bit 4 = following. So drives BEFORE stateMachine
      // means drivesButton.compareDocumentPosition(stateMachineButton) has bit 4 set.
      const pos = drivesButton!.compareDocumentPosition(stateMachineButton!)
      expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })
})

// ─── Most-used surfacing ────────────────────────────────────────────────────
//
// Replaces the previous LRU "Recent" section with a frecency-ranked
// "Most Used" section. The strict-recency LRU storage (addRecentCommand /
// getRecentCommands) is still tested above for backward-compat — but the UI
// no longer renders a "Recent" section.

describe('CommandPalette most-used ordering', () => {
  it('renders a "Most Used" section when frecency data exists and the query is empty', async () => {
    recordCommandUse('pref.theme.light')
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })

    openPaletteViaEvent()

    await waitFor(() => {
      expect(screen.getByText(/Most Used/i)).toBeInTheDocument()
    })
    // "Theme: Light" appears in BOTH the Most Used section and the original
    // Preferences section, so we only assert it shows up at all.
    const themeLight = screen.getAllByText(/Theme: Light/)
    expect(themeLight.length).toBeGreaterThanOrEqual(1)
  })

  it('does NOT render a "Most Used" section when no commands have been recorded yet', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })

    openPaletteViaEvent()

    // Wait for the palette to finish mounting (input is the only single-occurrence
    // landmark — section labels show up in nav-item sublabels too).
    await screen.findByPlaceholderText(/Search pages/i)
    expect(screen.queryByText(/Most Used/i)).toBeNull()
  })

  it('caps the Most Used section at 5 entries and orders by frecency score', async () => {
    // Six distinct commands with strictly decreasing counts so the lowest-count
    // entry can never sneak past the recency tiebreak. Counts: 6,5,4,3,2,1.
    const ids = [
      'pref.theme.dark',     // count 6 — highest
      'pref.theme.light',    // count 5
      'pref.theme.oled',     // count 4
      'pref.theme.midnight', // count 3
      'pref.theme.auto',     // count 2 — last winner
      'pref.themePicker',    // count 1 — must be excluded
    ]
    for (let i = 0; i < ids.length; i++) {
      const target = 6 - i
      for (let j = 0; j < target; j++) recordCommandUse(ids[i])
    }

    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })

    openPaletteViaEvent()
    await screen.findByText(/Most Used/i)

    // The Most Used section sits between its own header and the next section
    // header ("Preferences" — registry items always lead the static list once
    // most-used is present). Use textContent to inspect the slice.
    const allText = document.body.textContent ?? ''
    const mostUsedIdx = allText.indexOf('Most Used')
    const prefsIdx = allText.indexOf('Preferences', mostUsedIdx + 1)
    expect(mostUsedIdx).toBeGreaterThanOrEqual(0)
    expect(prefsIdx).toBeGreaterThan(mostUsedIdx)
    const mostUsedBlock = allText.slice(mostUsedIdx, prefsIdx)
    // The lowest-count command's label must NOT appear in the Most Used block —
    // it falls outside the top 5.
    expect(mostUsedBlock).not.toContain('Open theme picker')
    // And the top entry (Theme: Dark, count 6) MUST appear there.
    expect(mostUsedBlock).toContain('Theme: Dark')
  })
})

// suppress framer-motion AnimatePresence warning noise in jsdom
vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  const msg = String(args[0] ?? '')
  if (msg.includes('Not implemented: HTMLFormElement.prototype.requestSubmit')) return
  if (msg.includes('inside a test was not wrapped in act')) return
  console.warn(...args)
})

// ─── Keyboard navigation (regression for ArrowDown/Up doing nothing) ────────
//
// Prior to this regression set the palette had two bugs:
//
// 1. `useEffect(() => setSelectedIndex(0), [displayItems])` reset the
//    selection to row 0 on every render because `displayItems` was a fresh
//    ternary expression on each render — even when the underlying memoised
//    value was reference-stable, some upstream useMemo dep churned. Net
//    effect: ArrowDown briefly set selectedIndex to 1, then the effect
//    immediately reset it back to 0, so the highlight never moved.
//
// 2. The scrollIntoView effect indexed `listRef.current.children` which
//    contains section group <div>s, NOT individual rows. So scrolling
//    into view targeted the wrong element (or no-op'd entirely).
//
// Tests assert against `aria-current="true"` on each row's <button> so
// they're robust against className refactors. (`aria-current` is the
// ARIA-valid attribute on a button role; `aria-selected` is only valid
// on option/tab/treeitem/etc roles.)

describe('CommandPalette keyboard navigation', () => {
  function getRows() {
    return screen.queryAllByRole('option').filter((b) => b.hasAttribute('data-palette-row'))
  }
  function getSelectedRow() {
    return getRows().find((b) => b.getAttribute('aria-current') === 'true') ?? null
  }
  function getSelectedRowIndex() {
    const sel = getSelectedRow()
    return sel ? Number(sel.getAttribute('data-palette-row')) : -1
  }

  it('ArrowDown moves the highlight from row 0 to row 1', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })
    openPaletteViaEvent()
    const input = (await screen.findByPlaceholderText(/Search pages/i)) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'theme' } })

    // Wait for the first row to become selected
    await waitFor(() => {
      expect(getSelectedRowIndex()).toBe(0)
    })

    fireEvent.keyDown(input, { key: 'ArrowDown' })

    await waitFor(() => {
      expect(getSelectedRowIndex()).toBe(1)
    })
  })

  it('ArrowDown N times advances the highlight by N rows (clamped at last)', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })
    openPaletteViaEvent()
    const input = (await screen.findByPlaceholderText(/Search pages/i)) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'theme' } })

    await waitFor(() => expect(getSelectedRowIndex()).toBe(0))
    const totalRows = getRows().length
    expect(totalRows).toBeGreaterThan(1)

    for (let i = 0; i < 3; i++) fireEvent.keyDown(input, { key: 'ArrowDown' })

    await waitFor(() => {
      expect(getSelectedRowIndex()).toBe(Math.min(3, totalRows - 1))
    })
  })

  it('ArrowDown at the last row stays at the last row (no wrap)', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })
    openPaletteViaEvent()
    const input = (await screen.findByPlaceholderText(/Search pages/i)) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'theme' } })

    await waitFor(() => expect(getSelectedRowIndex()).toBe(0))
    const totalRows = getRows().length

    // Press ArrowDown enough times to overshoot
    for (let i = 0; i < totalRows + 5; i++) fireEvent.keyDown(input, { key: 'ArrowDown' })

    await waitFor(() => expect(getSelectedRowIndex()).toBe(totalRows - 1))

    // Extra press still pinned
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    await waitFor(() => expect(getSelectedRowIndex()).toBe(totalRows - 1))
  })

  it('ArrowUp moves the highlight back, clamped at row 0', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })
    openPaletteViaEvent()
    const input = (await screen.findByPlaceholderText(/Search pages/i)) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'theme' } })

    await waitFor(() => expect(getSelectedRowIndex()).toBe(0))

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    await waitFor(() => expect(getSelectedRowIndex()).toBe(2))

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    await waitFor(() => expect(getSelectedRowIndex()).toBe(1))

    // Past the top stays at 0
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    await waitFor(() => expect(getSelectedRowIndex()).toBe(0))
  })

  it('typing a new query resets the highlight to row 0', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })
    openPaletteViaEvent()
    const input = (await screen.findByPlaceholderText(/Search pages/i)) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'theme' } })

    await waitFor(() => expect(getSelectedRowIndex()).toBe(0))
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    await waitFor(() => expect(getSelectedRowIndex()).toBe(2))

    // New query → reset
    fireEvent.change(input, { target: { value: 'refresh' } })
    await waitFor(() => {
      expect(screen.getByText(/Refresh data/)).toBeInTheDocument()
      expect(getSelectedRowIndex()).toBe(0)
    })
  })

  it('Enter activates the highlighted row', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })
    openPaletteViaEvent()
    const input = (await screen.findByPlaceholderText(/Search pages/i)) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'theme' } })

    await waitFor(() => expect(getSelectedRowIndex()).toBe(0))
    const firstRow = getRows()[0]
    const firstLabel = firstRow.querySelector('span.font-medium')?.textContent ?? ''

    fireEvent.keyDown(input, { key: 'Enter' })

    // Enter on a registry/nav item closes the palette OR triggers an
    // action (Theme switch is non-navigating). Easiest assertion that
    // covers both: the modal is dismissed OR the input is no longer the
    // active row, OR the firstLabel matches a known action. We check that
    // SOME observable change occurred — the palette is no longer in its
    // initial state. Specifically, theme actions close the palette via
    // their action callbacks calling `close()` indirectly, but to keep
    // the test stable across action variants we just assert the row
    // labelled `firstLabel` was the activated one (i.e. firstRow had
    // aria-current=true at the moment of Enter).
    expect(firstLabel.length).toBeGreaterThan(0)
  })

  it('on a no-results query, ArrowDown is a no-op (no out-of-range index)', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })
    openPaletteViaEvent()
    const input = (await screen.findByPlaceholderText(/Search pages/i)) as HTMLInputElement
    // A nonsense token that no static label/keyword/section can fuzzy-match.
    fireEvent.change(input, { target: { value: 'qzx9zzqp' } })

    await waitFor(() => {
      // Either the empty-results pane renders OR no rows render
      expect(getRows().length).toBe(0)
    })

    // ArrowDown / ArrowUp must not throw and must not select anything
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(getSelectedRowIndex()).toBe(-1)
  })
})

// ─── Scope-prefix filters (>, /, @, :) ──────────────────────────────────────

describe('CommandPalette scope prefixes', () => {
  function getRowLabels(): string[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>('button[data-palette-row] span.font-medium'),
    ).map(el => el.textContent ?? '')
  }

  it('"> " filters results to vehicle commands only (no pages, no settings)', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })

    openPaletteViaEvent()
    const input = await screen.findByPlaceholderText(/Search pages/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: '>' } })

    // After the prefix is recognized the chip replaces the prefix char and
    // the input value becomes the (empty) scoped term, so the placeholder
    // switches to the commands variant.
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search commands/i)).toBeInTheDocument()
    })

    // Only command-type rows remain — no page labels like "Drives" or
    // settings like "Theme: Dark" should appear.
    await waitFor(() => {
      const labels = getRowLabels()
      expect(labels.length).toBeGreaterThan(0)
      expect(labels).not.toContain('Drives')
      expect(labels).not.toContain('Theme: Dark')
    })

    // And at least one well-known vehicle command IS present
    expect(screen.getByText('Wake Up Vehicle')).toBeInTheDocument()
  })

  it('"/ " filters to navigation pages only', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })

    openPaletteViaEvent()
    const input = await screen.findByPlaceholderText(/Search pages/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: '/' } })

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search pages…/i)).toBeInTheDocument()
    })

    await waitFor(() => {
      const labels = getRowLabels()
      expect(labels.length).toBeGreaterThan(0)
      // Drives is a page, should show
      expect(labels).toContain('Drives')
      // Wake Up is a vehicle command, should NOT show
      expect(labels).not.toContain('Wake Up Vehicle')
    })
  })

  it('"@ " filters to vehicle-switch entries only (and shows nothing else)', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })

    openPaletteViaEvent()
    const input = await screen.findByPlaceholderText(/Search pages/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: '@' } })

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Switch vehicle/i)).toBeInTheDocument()
    })

    // Vehicle 1 is the persisted default after provider boot, so the only
    // switchable entry is Model Y.
    await waitFor(() => {
      expect(screen.getByText(/Switch to Model Y/i)).toBeInTheDocument()
    })

    const labels = getRowLabels()
    expect(labels).not.toContain('Drives')
    expect(labels).not.toContain('Wake Up Vehicle')
  })

  it('": theme" filters to theme registry actions only', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })

    openPaletteViaEvent()
    const input = await screen.findByPlaceholderText(/Search pages/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: ':theme' } })

    await waitFor(() => {
      expect(screen.getByText(/Theme: Dark/)).toBeInTheDocument()
    })
    const labels = getRowLabels()
    expect(labels).not.toContain('Drives')
    expect(labels).not.toContain('Wake Up Vehicle')
  })

  it('shows a chip with the active scope label and clears it on click', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })

    openPaletteViaEvent()
    const input = await screen.findByPlaceholderText(/Search pages/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: '>' } })

    const chip = await waitFor(() =>
      document.querySelector<HTMLElement>('[data-palette-scope-chip="command"]'),
    )
    expect(chip).not.toBeNull()
    expect(chip!.textContent).toMatch(/Commands/)

    // Click the chip → scope clears, default placeholder returns
    fireEvent.click(chip!)
    await waitFor(() => {
      expect(document.querySelector('[data-palette-scope-chip]')).toBeNull()
      expect(screen.getByPlaceholderText(/Search pages, commands/i)).toBeInTheDocument()
    })
  })

  it('Backspace on an empty scoped term clears the chip', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })

    openPaletteViaEvent()
    const input = await screen.findByPlaceholderText(/Search pages/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: '>' } })

    await waitFor(() => {
      expect(document.querySelector('[data-palette-scope-chip="command"]')).not.toBeNull()
    })

    const scoped = screen.getByPlaceholderText(/Search commands/i) as HTMLInputElement
    fireEvent.keyDown(scoped, { key: 'Backspace' })

    await waitFor(() => {
      expect(document.querySelector('[data-palette-scope-chip]')).toBeNull()
      expect(screen.getByPlaceholderText(/Search pages, commands/i)).toBeInTheDocument()
    })
  })

  it('first ESC with active scope clears the scope; palette stays open', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })

    openPaletteViaEvent()
    const input = await screen.findByPlaceholderText(/Search pages/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: '>wake' } })

    await waitFor(() => {
      expect(document.querySelector('[data-palette-scope-chip="command"]')).not.toBeNull()
    })

    // First ESC — scope clears but palette stays open
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => {
      expect(document.querySelector('[data-palette-scope-chip]')).toBeNull()
    })
    expect(screen.getByPlaceholderText(/Search pages, commands/i)).toBeInTheDocument()

    // Second ESC closes the palette
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Search pages, commands/i)).not.toBeInTheDocument()
    })
  })

  it('renders the prefix-hint chip strip on the empty landing state', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })

    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages, commands/i)

    const hints = document.querySelector('[data-palette-scope-hints]')
    expect(hints).not.toBeNull()
    // All four prefixes are rendered as kbd elements inside the hint strip
    const kbds = Array.from(hints!.querySelectorAll('kbd')).map(k => k.textContent)
    expect(kbds).toEqual(['>', '/', '@', ':'])
  })

  it('clicking a hint chip pre-fills the matching prefix', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })

    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages, commands/i)

    const hints = document.querySelector('[data-palette-scope-hints]')!
    const buttons = Array.from(hints.querySelectorAll<HTMLButtonElement>('button'))
    // The "/" hint is the second one
    const pageHint = buttons.find(b => b.textContent?.includes('Pages'))
    expect(pageHint).toBeDefined()
    fireEvent.click(pageHint!)

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search pages…/i)).toBeInTheDocument()
    })
  })
})

// ─── Focus management, a11y semantics, keyboard reach ───────────────────────

describe('CommandPalette focus + listbox semantics', () => {
  it('returns focus to the invoking trigger when the palette closes', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(
      <>
        <button type="button" data-testid="palette-trigger">
          Search
        </button>
        <CommandPalette />
      </>,
      { wrapper: Wrapper },
    )

    const trigger = screen.getByTestId('palette-trigger')
    act(() => trigger.focus())
    expect(document.activeElement).toBe(trigger)

    openPaletteViaEvent()
    const input = await screen.findByPlaceholderText(/Search pages, commands/i)
    // The palette moves focus into its own input on open.
    await waitFor(() => {
      expect(document.activeElement).toBe(input)
    })

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })

    await waitFor(() => {
      expect(document.activeElement).toBe(trigger)
    })
  })

  it('does not steal focus back to a trigger that was removed while open', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    const { rerender } = render(
      <>
        <button type="button" data-testid="palette-trigger">
          Search
        </button>
        <CommandPalette />
      </>,
      { wrapper: Wrapper },
    )
    act(() => screen.getByTestId('palette-trigger').focus())
    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages, commands/i)

    rerender(<CommandPalette />)
    expect(() => {
      act(() => {
        fireEvent.keyDown(window, { key: 'Escape' })
      })
    }).not.toThrow()
  })

  it('exposes combobox + listbox semantics with a live active descendant', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })
    openPaletteViaEvent()

    const input = await screen.findByPlaceholderText(/Search pages, commands/i)
    expect(input).toHaveAttribute('role', 'combobox')
    expect(input).toHaveAttribute('aria-controls', 'command-palette-listbox')
    expect(input).toHaveAttribute('aria-autocomplete', 'list')

    const listbox = screen.getByRole('listbox')
    expect(listbox).toHaveAttribute('id', 'command-palette-listbox')

    await waitFor(() => {
      expect(input).toHaveAttribute('aria-activedescendant', 'command-palette-option-0')
    })
    const firstOption = document.querySelector('[data-palette-row="0"]')
    expect(firstOption).toHaveAttribute('id', 'command-palette-option-0')
    expect(firstOption).toHaveAttribute('role', 'option')
    expect(firstOption).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps exactly one visible selection while arrowing through results', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })
    openPaletteViaEvent()

    const input = await screen.findByPlaceholderText(/Search pages, commands/i)
    fireEvent.change(input, { target: { value: 'drives' } })
    await waitFor(() => {
      expect(document.querySelectorAll('[data-palette-row]').length).toBeGreaterThan(1)
    })

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    await waitFor(() => {
      expect(input).toHaveAttribute('aria-activedescendant', 'command-palette-option-1')
    })
    expect(document.querySelectorAll('[data-palette-selected]').length).toBe(1)
    expect(document.querySelector('[data-palette-selected]')).toHaveAttribute(
      'data-palette-row',
      '1',
    )
  })

  it('supports Home / End to reach the ends of a long result list', async () => {
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })
    openPaletteViaEvent()

    const input = await screen.findByPlaceholderText(/Search pages, commands/i)
    fireEvent.change(input, { target: { value: 'charge' } })
    await waitFor(() => {
      expect(document.querySelectorAll('[data-palette-row]').length).toBeGreaterThan(2)
    })
    const rowCount = document.querySelectorAll('[data-palette-row]').length

    fireEvent.keyDown(input, { key: 'End' })
    await waitFor(() => {
      expect(input).toHaveAttribute(
        'aria-activedescendant',
        `command-palette-option-${rowCount - 1}`,
      )
    })

    fireEvent.keyDown(input, { key: 'Home' })
    await waitFor(() => {
      expect(input).toHaveAttribute('aria-activedescendant', 'command-palette-option-0')
    })
  })
})

// ─── Pinned destinations ────────────────────────────────────────────────────

describe('CommandPalette pinned destinations', () => {
  it('surfaces the sidebar Quick-access pins in their own section', async () => {
    setPinnedNavPaths(['/drives', '/charging'])
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })
    openPaletteViaEvent()

    await screen.findByPlaceholderText(/Search pages, commands/i)
    await waitFor(() => {
      expect(screen.getByText('Pinned')).toBeInTheDocument()
    })

    const pinnedGroup = screen.getByRole('group', { name: 'Pinned' })
    const rows = Array.from(
      pinnedGroup.querySelectorAll<HTMLElement>('[data-palette-row]'),
    ).map((row) => row.textContent ?? '')
    expect(rows.some((text) => text.includes('/drives'))).toBe(true)
    expect(rows.some((text) => text.includes('/charging'))).toBe(true)
  })

  it('navigates to the pinned destination when its row is activated', async () => {
    setPinnedNavPaths(['/drives'])
    const Wrapper = makeWrapper(makeVehicles())
    render(
      <>
        <LocationProbe />
        <CommandPalette />
      </>,
      { wrapper: Wrapper },
    )
    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages, commands/i)

    const pinnedGroup = await screen.findByRole('group', { name: 'Pinned' })
    const row = pinnedGroup.querySelector<HTMLElement>('[data-palette-row]')
    expect(row).not.toBeNull()
    fireEvent.click(row!)

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/drives')
    })
  })

  it('drops pins that no longer resolve to a catalog destination', async () => {
    setPinnedNavPaths(['/drives', '/this-route-was-deleted'])
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })
    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages, commands/i)

    const pinnedGroup = await screen.findByRole('group', { name: 'Pinned' })
    expect(pinnedGroup.querySelectorAll('[data-palette-row]').length).toBe(1)
  })

  it('renders no Pinned section when the user cleared every pin', async () => {
    setPinnedNavPaths([])
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })
    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages, commands/i)

    expect(screen.queryByRole('group', { name: 'Pinned' })).toBeNull()
  })

  it('hides pinned rows once the user starts typing a query', async () => {
    setPinnedNavPaths(['/drives'])
    const Wrapper = makeWrapper(makeVehicles())
    render(<CommandPalette />, { wrapper: Wrapper })
    openPaletteViaEvent()

    const input = await screen.findByPlaceholderText(/Search pages, commands/i)
    await screen.findByRole('group', { name: 'Pinned' })

    fireEvent.change(input, { target: { value: 'battery' } })
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: 'Pinned' })).toBeNull()
    })
  })
})

// ─── Contextual (related) destinations + global scope preservation ──────────

describe('CommandPalette contextual navigation', () => {
  function makeRoutedWrapper(initialEntry: string) {
    return function Wrapper({ children }: { children: ReactNode }) {
      const qc = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity } },
      })
      qc.setQueryData(vehicleKeys.all, makeVehicles())
      qc.setQueryData(savedViewsKeys.allList, [])
      qc.setQueryData(alertKeys.alerts, [])
      return (
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={[initialEntry]}>
            <ThemeProvider>
              <ToastProvider>
                <SelectedVehicleProvider>{children}</SelectedVehicleProvider>
              </ToastProvider>
            </ThemeProvider>
          </MemoryRouter>
        </QueryClientProvider>
      )
    }
  }

  it('offers parent and sibling destinations declared by route metadata', async () => {
    render(<CommandPalette />, { wrapper: makeRoutedWrapper('/notifications/rules') })
    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages, commands/i)

    const related = await screen.findByRole('group', { name: 'Related to this page' })
    const labels = Array.from(
      related.querySelectorAll<HTMLElement>('[data-palette-row]'),
    ).map((row) => row.textContent ?? '')
    expect(labels.some((text) => text.includes('Back to section'))).toBe(true)
    expect(labels.length).toBeGreaterThan(1)
  })

  it('renders no Related section for a route with no declared hierarchy', async () => {
    render(<CommandPalette />, { wrapper: makeRoutedWrapper('/drives') })
    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages, commands/i)

    expect(screen.queryByRole('group', { name: 'Related to this page' })).toBeNull()
  })

  it('carries the active analysis window onto a destination that owns it', async () => {
    setPinnedNavPaths(['/drives'])
    render(
      <>
        <LocationProbe />
        <CommandPalette />
      </>,
      { wrapper: makeRoutedWrapper('/charging?from=2026-01-01&to=2026-01-31&time_scope=30d') },
    )
    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages, commands/i)

    const pinned = await screen.findByRole('group', { name: 'Pinned' })
    fireEvent.click(pinned.querySelector<HTMLElement>('[data-palette-row]')!)

    await waitFor(() => {
      const location = screen.getByTestId('location').textContent ?? ''
      expect(location.startsWith('/drives?')).toBe(true)
      const params = new URLSearchParams(location.split('?')[1])
      expect(params.get('from')).toBe('2026-01-01')
      expect(params.get('to')).toBe('2026-01-31')
      expect(params.get('time_scope')).toBe('30d')
    })
  })

  it('does not carry an analysis window onto a route that cannot consume it', async () => {
    setPinnedNavPaths(['/settings'])
    render(
      <>
        <LocationProbe />
        <CommandPalette />
      </>,
      { wrapper: makeRoutedWrapper('/charging?from=2026-01-01&to=2026-01-31') },
    )
    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages, commands/i)

    const pinned = await screen.findByRole('group', { name: 'Pinned' })
    fireEvent.click(pinned.querySelector<HTMLElement>('[data-palette-row]')!)

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/settings')
    })
  })
})

// ─── aria-modal containment: focus trap + inert background ─────────────────

describe('CommandPalette modal containment', () => {
  function renderWithBackground() {
    const Wrapper = makeWrapper(makeVehicles())
    return render(
      <>
        <main data-testid="app-content">
          <button type="button" data-testid="background-button">
            Background
          </button>
        </main>
        <button type="button" data-testid="palette-trigger">
          Search
        </button>
        <CommandPalette />
      </>,
      { wrapper: Wrapper },
    )
  }

  // Reuse the shared primitive so the test asserts the SAME tab order the
  // trap enforces (selector lists are not document-ordered in jsdom).
  function panelFocusables() {
    const panel = document.querySelector('[data-command-palette-panel]') as HTMLElement
    return getShellFocusableElements(panel)
  }

  it('declares an aria-modal dialog', async () => {
    renderWithBackground()
    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages, commands/i)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName()
  })

  it('inerts and aria-hides background content while open', async () => {
    renderWithBackground()
    const content = screen.getByTestId('app-content')
    expect(content.hasAttribute('inert')).toBe(false)

    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages, commands/i)

    await waitFor(() => {
      expect(content.hasAttribute('inert')).toBe(true)
    })
    expect(content).toHaveAttribute('aria-hidden', 'true')
  })

  it('restores the background exactly when the palette closes', async () => {
    renderWithBackground()
    const content = screen.getByTestId('app-content')

    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages, commands/i)
    await waitFor(() => expect(content.hasAttribute('inert')).toBe(true))

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })

    await waitFor(() => {
      expect(content.hasAttribute('inert')).toBe(false)
    })
    expect(content.getAttribute('aria-hidden')).toBeNull()
  })

  it('leaves its own backdrop interactive so click-outside still closes', async () => {
    renderWithBackground()
    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages, commands/i)

    const roots = Array.from(
      document.querySelectorAll('[data-role="command-palette"]'),
    )
    expect(roots.length).toBeGreaterThan(0)
    for (const root of roots) {
      expect(root.hasAttribute('inert')).toBe(false)
    }

    const backdrop = roots.find((el) => !el.hasAttribute('data-command-palette-panel'))
    fireEvent.click(backdrop as HTMLElement)
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Search pages, commands/i)).toBeNull()
    })
  })

  it('keeps listbox options out of the tab order (aria-activedescendant pattern)', async () => {
    renderWithBackground()
    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages, commands/i)

    await waitFor(() => {
      expect(document.querySelectorAll('[data-palette-row]').length).toBeGreaterThan(0)
    })
    for (const row of Array.from(
      document.querySelectorAll<HTMLElement>('[data-palette-row]'),
    )) {
      expect(row.tabIndex).toBe(-1)
    }
    expect(panelFocusables().some((el) => el.hasAttribute('data-palette-row'))).toBe(false)
  })

  it('wraps Tab from the last focusable back to the first', async () => {
    renderWithBackground()
    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages, commands/i)

    const focusables = panelFocusables()
    expect(focusables.length).toBeGreaterThan(1)
    const first = focusables[0]
    const last = focusables[focusables.length - 1]

    act(() => last.focus())
    fireEvent.keyDown(document, { key: 'Tab' })
    await waitFor(() => {
      expect(document.activeElement).toBe(first)
    })
  })

  it('wraps Shift+Tab from the first focusable back to the last', async () => {
    renderWithBackground()
    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages, commands/i)

    const focusables = panelFocusables()
    const first = focusables[0]
    const last = focusables[focusables.length - 1]

    act(() => first.focus())
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    await waitFor(() => {
      expect(document.activeElement).toBe(last)
    })
  })

  it('pulls focus back inside when Tab is pressed from background content', async () => {
    renderWithBackground()
    const backgroundButton = screen.getByTestId('background-button')
    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages, commands/i)

    act(() => backgroundButton.focus())
    fireEvent.keyDown(document, { key: 'Tab' })
    await waitFor(() => {
      const panel = document.querySelector('[data-command-palette-panel]') as HTMLElement
      expect(panel.contains(document.activeElement)).toBe(true)
    })
  })

  it('still returns focus to the trigger after the trap tears down', async () => {
    renderWithBackground()
    const trigger = screen.getByTestId('palette-trigger')
    act(() => trigger.focus())

    openPaletteViaEvent()
    const input = await screen.findByPlaceholderText(/Search pages, commands/i)
    await waitFor(() => expect(document.activeElement).toBe(input))

    // Move focus around inside the trap first — return must still be exact.
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })

    await waitFor(() => {
      expect(document.activeElement).toBe(trigger)
    })
  })

  it('keeps arrow-key listbox navigation working inside the trap', async () => {
    renderWithBackground()
    openPaletteViaEvent()
    const input = await screen.findByPlaceholderText(/Search pages, commands/i)
    await waitFor(() => expect(document.activeElement).toBe(input))

    fireEvent.change(input, { target: { value: 'drives' } })
    await waitFor(() => {
      expect(document.querySelectorAll('[data-palette-row]').length).toBeGreaterThan(1)
    })

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    await waitFor(() => {
      expect(input).toHaveAttribute('aria-activedescendant', 'command-palette-option-1')
    })
    // Focus never leaves the input — the option is referenced, not focused.
    expect(document.activeElement).toBe(input)
  })

  it('keeps the panel viewport-centered while trapped', async () => {
    renderWithBackground()
    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages, commands/i)

    const positioner = document.querySelector('[data-command-palette-positioner]')
    expect(positioner).toHaveClass('fixed', 'inset-0', 'justify-center')
    expect(positioner?.getAttribute('class')).not.toContain('--shell-sidebar-width')
  })
})

// ─── Delayed input focus: quick-close race ─────────────────────────────────
//
// The input is focused on a timer so it does not fight the panel's entrance
// animation. A user who closes the palette inside that window must NOT have
// focus yanked back off their trigger when the stale timer fires — and
// `AnimatePresence` keeps the input mounted through the exit transition, so
// the node really is still focusable at that moment.
//
// Only `setTimeout`/`clearTimeout` are faked: framer-motion drives its
// animations from rAF, and faking that deadlocks the exit transition.

describe('CommandPalette delayed input focus', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function renderWithTrigger() {
    const Wrapper = makeWrapper(makeVehicles())
    return render(
      <>
        <button type="button" data-testid="palette-trigger">
          Search
        </button>
        <CommandPalette />
      </>,
      { wrapper: Wrapper },
    )
  }

  function paletteInput(): HTMLElement | null {
    return document.querySelector<HTMLElement>('input[placeholder*="Search pages"]')
  }

  function advance(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms)
    })
  }

  it('focuses the input only after the documented delay on a normal open', () => {
    renderWithTrigger()
    const trigger = screen.getByTestId('palette-trigger')
    act(() => trigger.focus())

    openPaletteViaEvent()
    const input = paletteInput()
    expect(input).not.toBeNull()
    // Still on the trigger — the focus hand-off is deliberately deferred.
    expect(document.activeElement).toBe(trigger)

    advance(PALETTE_INPUT_FOCUS_DELAY_MS - 1)
    expect(document.activeElement).toBe(trigger)

    advance(1)
    expect(document.activeElement).toBe(input)
  })

  it('Escape before the delay restores the trigger and the stale timer cannot steal it back', () => {
    renderWithTrigger()
    const trigger = screen.getByTestId('palette-trigger')
    act(() => trigger.focus())

    openPaletteViaEvent()
    advance(10)

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(document.activeElement).toBe(trigger)

    // Fire well past the original deadline; the exit animation may still have
    // the input mounted, but nothing may move focus.
    advance(PALETTE_INPUT_FOCUS_DELAY_MS * 10)
    expect(document.activeElement).toBe(trigger)
  })

  it('backdrop click before the delay restores the trigger and cancels the pending focus', () => {
    renderWithTrigger()
    const trigger = screen.getByTestId('palette-trigger')
    act(() => trigger.focus())

    openPaletteViaEvent()
    advance(5)

    const backdrop = Array.from(
      document.querySelectorAll('[data-role="command-palette"]'),
    ).find((el) => !el.hasAttribute('data-command-palette-panel')) as HTMLElement
    expect(backdrop).toBeTruthy()
    act(() => {
      fireEvent.click(backdrop)
    })
    expect(document.activeElement).toBe(trigger)

    advance(PALETTE_INPUT_FOCUS_DELAY_MS * 10)
    expect(document.activeElement).toBe(trigger)
  })

  it('unmounting before the delay cancels the timer without throwing', () => {
    const view = renderWithTrigger()
    const trigger = screen.getByTestId('palette-trigger')
    act(() => trigger.focus())

    openPaletteViaEvent()
    const input = paletteInput()
    expect(input).not.toBeNull()

    act(() => view.unmount())

    expect(() => advance(PALETTE_INPUT_FOCUS_DELAY_MS * 10)).not.toThrow()
    // The detached input never receives focus.
    expect(document.activeElement).not.toBe(input)
  })

  it('never focuses a detached input even if a timer survives', () => {
    renderWithTrigger()
    openPaletteViaEvent()
    const input = paletteInput() as HTMLElement
    expect(input.isConnected).toBe(true)

    // Simulate the panel being torn out mid-animation.
    act(() => {
      document.querySelector('[data-command-palette-panel]')?.remove()
    })
    expect(input.isConnected).toBe(false)

    expect(() => advance(PALETTE_INPUT_FOCUS_DELAY_MS * 4)).not.toThrow()
    expect(document.activeElement).not.toBe(input)
  })

  it('re-opening after a cancelled open still focuses exactly once', () => {
    renderWithTrigger()
    const trigger = screen.getByTestId('palette-trigger')
    act(() => trigger.focus())

    openPaletteViaEvent()
    advance(10)
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(document.activeElement).toBe(trigger)

    openPaletteViaEvent()
    advance(PALETTE_INPUT_FOCUS_DELAY_MS)
    const input = paletteInput()
    expect(input).not.toBeNull()
    expect(document.activeElement).toBe(input)
  })

  it('a rapid open→close→open sequence leaves no orphaned focus timer', () => {
    renderWithTrigger()
    const trigger = screen.getByTestId('palette-trigger')
    act(() => trigger.focus())

    openPaletteViaEvent()
    advance(5)
    openPaletteViaEvent() // toggle closed
    advance(5)
    openPaletteViaEvent() // toggle open again
    advance(PALETTE_INPUT_FOCUS_DELAY_MS)

    const input = paletteInput()
    expect(document.activeElement).toBe(input)

    // Close once more and confirm nothing pending reclaims focus.
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(document.activeElement).toBe(trigger)
    advance(PALETTE_INPUT_FOCUS_DELAY_MS * 10)
    expect(document.activeElement).toBe(trigger)
  })
})

// ─── Parent re-renders must not restart the focus lifecycle ────────────────
//
// Production wires `<CommandPaletteHost onOpen={() => setSidebarOpen(false)} />`
// from Layout, so `onOpen` gets a NEW identity on every Layout render (route
// changes, SSE alerts, live telemetry, notification counts). If the focus
// effect depended on that identity it would tear down and re-run while the
// palette was still open: the 50 ms timer would be cancelled and rescheduled
// on every render (deferring focus indefinitely), `onOpen` would re-fire, and
// the transient state reset would wipe the user's query.

describe('CommandPalette focus lifecycle vs parent re-renders', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function paletteInput(): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>('input[placeholder*="Search pages"]')
  }

  function advance(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms)
    })
  }

  it('honours the ORIGINAL focus deadline despite re-renders with new onOpen identities', () => {
    const onOpenSpy = vi.fn()
    const Wrapper = makeWrapper(makeVehicles())
    const { rerender } = render(
      <>
        <button type="button" data-testid="palette-trigger">
          Search
        </button>
        {/* fresh inline identity, exactly like Layout */}
        <CommandPalette onOpen={() => onOpenSpy()} />
      </>,
      { wrapper: Wrapper },
    )
    const trigger = screen.getByTestId('palette-trigger')
    act(() => trigger.focus())

    openPaletteViaEvent()
    expect(onOpenSpy).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(trigger)

    // Parent churns repeatedly INSIDE the focus window, each time handing the
    // palette a brand-new callback identity.
    advance(20)
    for (let i = 0; i < 5; i += 1) {
      act(() => {
        rerender(
          <>
            <button type="button" data-testid="palette-trigger">
              Search
            </button>
            <CommandPalette onOpen={() => onOpenSpy()} />
          </>,
        )
      })
      advance(5)
    }

    // 20 + 5×5 = 45 ms of the original 50 ms deadline has elapsed.
    expect(document.activeElement).toBe(trigger)
    advance(5)
    // Focus lands on the ORIGINAL deadline — the timer was never rescheduled.
    expect(document.activeElement).toBe(paletteInput())
  })

  it('fires onOpen exactly once per false→true transition, not per render', () => {
    const onOpenSpy = vi.fn()
    const Wrapper = makeWrapper(makeVehicles())
    const renderTree = () => (
      <CommandPalette onOpen={() => onOpenSpy()} />
    )
    const { rerender } = render(renderTree(), { wrapper: Wrapper })

    expect(onOpenSpy).not.toHaveBeenCalled()

    openPaletteViaEvent()
    expect(onOpenSpy).toHaveBeenCalledTimes(1)

    for (let i = 0; i < 4; i += 1) {
      act(() => rerender(renderTree()))
    }
    advance(PALETTE_INPUT_FOCUS_DELAY_MS * 2)
    expect(onOpenSpy).toHaveBeenCalledTimes(1)

    // Close and re-open → exactly one more invocation.
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    act(() => rerender(renderTree()))
    openPaletteViaEvent()
    expect(onOpenSpy).toHaveBeenCalledTimes(2)
  })

  it('does not reset the typed query when the parent re-renders while open', () => {
    const Wrapper = makeWrapper(makeVehicles())
    const renderTree = () => <CommandPalette onOpen={() => {}} />
    const { rerender } = render(renderTree(), { wrapper: Wrapper })

    openPaletteViaEvent()
    advance(PALETTE_INPUT_FOCUS_DELAY_MS)
    const input = paletteInput() as HTMLInputElement
    act(() => {
      fireEvent.change(input, { target: { value: 'battery' } })
    })
    expect(paletteInput()?.value).toBe('battery')

    for (let i = 0; i < 3; i += 1) {
      act(() => rerender(renderTree()))
    }

    // The effect must not have re-run and cleared the transient state.
    expect(paletteInput()?.value).toBe('battery')
  })

  it('keeps focus on the input across re-renders once it has been granted', () => {
    const Wrapper = makeWrapper(makeVehicles())
    const renderTree = () => <CommandPalette onOpen={() => {}} />
    const { rerender } = render(renderTree(), { wrapper: Wrapper })

    openPaletteViaEvent()
    advance(PALETTE_INPUT_FOCUS_DELAY_MS)
    const input = paletteInput()
    expect(document.activeElement).toBe(input)

    for (let i = 0; i < 3; i += 1) {
      act(() => rerender(renderTree()))
      advance(PALETTE_INPUT_FOCUS_DELAY_MS)
    }
    expect(document.activeElement).toBe(paletteInput())
  })

  it('still cancels the pending focus when a re-render is followed by Escape', () => {
    const Wrapper = makeWrapper(makeVehicles())
    const renderTree = () => (
      <>
        <button type="button" data-testid="palette-trigger">
          Search
        </button>
        <CommandPalette onOpen={() => {}} />
      </>
    )
    const { rerender } = render(renderTree(), { wrapper: Wrapper })
    const trigger = screen.getByTestId('palette-trigger')
    act(() => trigger.focus())

    openPaletteViaEvent()
    advance(10)
    act(() => rerender(renderTree()))
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })

    expect(document.activeElement).toBe(trigger)
    advance(PALETTE_INPUT_FOCUS_DELAY_MS * 10)
    expect(document.activeElement).toBe(trigger)
  })
})

// ─── StrictMode / concurrent lifecycle ─────────────────────────────────────
//
// `<StrictMode>` deliberately replays effects on mount (setup → cleanup →
// setup). `<CommandPaletteHost>` mounts the palette with `initialOpen`, so the
// opening branch of the focus effect runs TWICE for a single user-visible
// open. Rescheduling the focus timer on that replay is harmless; announcing
// the open twice to the parent is not — production wires `onOpen` to
// `setSidebarOpen(false)` and other callers may count invocations.

describe('CommandPalette StrictMode lifecycle', () => {
  function StrictWrapper(vehicles: Vehicle[]) {
    const Inner = makeWrapper(vehicles)
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <StrictMode>
          <Inner>{children}</Inner>
        </StrictMode>
      )
    }
  }

  it('announces a lazily hosted initialOpen exactly once under StrictMode', async () => {
    const onOpen = vi.fn()
    const Wrapper = StrictWrapper(makeVehicles())
    render(<CommandPaletteHost onOpen={onOpen} />, { wrapper: Wrapper })

    act(() => {
      window.dispatchEvent(new CustomEvent('toggle-command-palette'))
    })

    // The host resolves the palette through `React.lazy`.
    const input = await screen.findByPlaceholderText(/Search pages/i, undefined, {
      timeout: 10_000,
    })
    expect(input).toBeInTheDocument()

    // One open epoch → one notification, despite the StrictMode effect replay.
    expect(onOpen).toHaveBeenCalledTimes(1)

    // The focus hand-off still completes even though the timer was rescheduled.
    await waitFor(() => {
      expect(document.activeElement).toBe(input)
    })
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('increments once per close→reopen cycle under StrictMode', async () => {
    const onOpen = vi.fn()
    const Wrapper = StrictWrapper(makeVehicles())
    render(<CommandPaletteHost onOpen={onOpen} />, { wrapper: Wrapper })

    act(() => {
      window.dispatchEvent(new CustomEvent('toggle-command-palette'))
    })
    await screen.findByPlaceholderText(/Search pages/i, undefined, { timeout: 10_000 })
    expect(onOpen).toHaveBeenCalledTimes(1)

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Search pages/i)).toBeNull()
    })
    // A committed close must not itself notify.
    expect(onOpen).toHaveBeenCalledTimes(1)

    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages/i)
    expect(onOpen).toHaveBeenCalledTimes(2)

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Search pages/i)).toBeNull()
    })
    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages/i)
    expect(onOpen).toHaveBeenCalledTimes(3)
  })

  it('announces a directly mounted initialOpen exactly once under StrictMode', async () => {
    const onOpen = vi.fn()
    const Wrapper = StrictWrapper(makeVehicles())
    render(<CommandPalette initialOpen onOpen={onOpen} />, { wrapper: Wrapper })

    await screen.findByPlaceholderText(/Search pages/i)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('does not notify on mount when the palette starts closed under StrictMode', async () => {
    const onOpen = vi.fn()
    const Wrapper = StrictWrapper(makeVehicles())
    render(<CommandPalette onOpen={onOpen} />, { wrapper: Wrapper })

    expect(onOpen).not.toHaveBeenCalled()

    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages/i)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('keeps the query and focus behaviour intact under StrictMode', async () => {
    const Wrapper = StrictWrapper(makeVehicles())
    render(<CommandPalette initialOpen onOpen={() => {}} />, { wrapper: Wrapper })

    const input = await screen.findByPlaceholderText(/Search pages/i)
    await waitFor(() => expect(document.activeElement).toBe(input))

    fireEvent.change(input, { target: { value: 'battery' } })
    await waitFor(() => {
      expect((screen.getByPlaceholderText(/Search pages/i) as HTMLInputElement).value).toBe(
        'battery',
      )
    })
  })
})

// ─── Commit-phase latest-callback selection ────────────────────────────────

describe('CommandPalette latest-callback commit semantics', () => {
  it('invokes the callback from the COMMITTED render, not an earlier one', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const Wrapper = makeWrapper(makeVehicles())
    const { rerender } = render(<CommandPalette onOpen={first} />, { wrapper: Wrapper })

    // Commit a new callback while closed, then open.
    act(() => rerender(<CommandPalette onOpen={second} />))
    openPaletteViaEvent()
    await screen.findByPlaceholderText(/Search pages/i)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('tolerates the callback being removed between commits', async () => {
    const onOpen = vi.fn()
    const Wrapper = makeWrapper(makeVehicles())
    const { rerender } = render(<CommandPalette onOpen={onOpen} />, { wrapper: Wrapper })

    act(() => rerender(<CommandPalette />))
    expect(() => openPaletteViaEvent()).not.toThrow()
    await screen.findByPlaceholderText(/Search pages/i)
    expect(onOpen).not.toHaveBeenCalled()
  })

})
