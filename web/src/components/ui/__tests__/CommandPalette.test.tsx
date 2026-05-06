import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/feedback/Toast'
import { ThemeProvider } from '@/components/ui/ThemeProvider'
import { SelectedVehicleProvider } from '@/store/selectedVehicle'
import { CommandPalette, addRecentCommand, getRecentCommands } from '../CommandPalette'
import { vehicleKeys } from '@/api/hooks/useVehicles'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { recordCommandUse, _resetFrecency } from '@/lib/commandFrecency'
import type { Vehicle } from '@/types/vehicle'
import type { ReactNode } from 'react'

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

// ─── Test plumbing ──────────────────────────────────────────────────────────

function makeVehicles(): Vehicle[] {
  return [
    { id: 1, vin: 'VIN1', display_name: 'Model 3', model: 'Model 3', state: 'online' } as Vehicle,
    { id: 2, vin: 'VIN2', display_name: 'Model Y', model: 'Model Y', state: 'asleep' } as Vehicle,
  ]
}

function makeWrapper(vehicles: Vehicle[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    qc.setQueryData(vehicleKeys.all, vehicles)
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
  _resetFrecency()
})

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
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

  // Regression for the post phase-40/45 scoring bug where each keyword was
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

// ─── Most-used surfacing (Phase-45 / Prompt 27) ─────────────────────────────
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
