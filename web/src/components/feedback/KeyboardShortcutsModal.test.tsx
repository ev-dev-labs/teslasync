import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * KeyboardShortcutsModal contract coverage.
 *
 * The modal is a thin, registry-driven view: it reads every registered
 * {@link ShortcutDefinition} from the shortcut registry, then filters
 * (by scope + free-text search), groups (by translated label) and orders
 * (by GROUP_PRIORITY, then id) them for display. These tests seed the real
 * registry via `registerShortcut`, render the modal inside a router, and
 * assert the observable behaviour a keyboard user would see:
 *   • open / closed rendering + dialog a11y
 *   • the (bug-fixed) descriptive tablist label
 *   • grouping, group ordering, intra-group id ordering
 *   • kbd-chip rendering incl. the "+" combo separator
 *   • debounced search + empty state
 *   • the three scope filters (All / Global / This page) incl. route + regex matching
 *   • sessionStorage persistence + restore of the chosen filter
 *   • search reset on close/reopen
 *   • null-safety for a definition with no keys
 *   • close-button wiring
 */

// i18n passthrough that honours the inline `t('key', 'Default')` fallback and
// interpolates {{tokens}} — mirrors the convention used by the sibling
// ReauthDialog / DraftRestorePrompt tests so no full i18n init is needed.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultOrOpts?: unknown, maybeOpts?: unknown) => {
      let fallback: string
      let opts: Record<string, unknown> | undefined
      if (typeof defaultOrOpts === 'string') {
        fallback = defaultOrOpts
        opts = maybeOpts as Record<string, unknown> | undefined
      } else {
        opts = defaultOrOpts as Record<string, unknown> | undefined
        fallback = (opts?.defaultValue as string | undefined) ?? key
      }
      let out = fallback ?? key
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          if (k.startsWith('default')) continue
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v))
        }
      }
      return out
    },
  }),
}))

import { KeyboardShortcutsModal } from './KeyboardShortcutsModal'
import {
  registerShortcut,
  _resetShortcutRegistry,
  type ShortcutDefinition,
} from '@/hooks/useShortcutRegistry'

const FILTER_STORAGE_KEY = 'teslasync:shortcuts:filter:v1'

function seed(...defs: ShortcutDefinition[]) {
  for (const d of defs) registerShortcut(d)
}

function renderModal(
  props: { open?: boolean; onClose?: () => void; path?: string } = {},
) {
  const { open = true, onClose = vi.fn(), path = '/' } = props
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <KeyboardShortcutsModal open={open} onClose={onClose} />
    </MemoryRouter>,
  )
  return { ...utils, onClose }
}

beforeEach(() => {
  sessionStorage.clear()
  _resetShortcutRegistry()
})

afterEach(() => {
  _resetShortcutRegistry()
  sessionStorage.clear()
})

describe('KeyboardShortcutsModal', () => {
  it('renders nothing when open=false', () => {
    seed({
      id: 'g.help',
      keys: ['?'],
      description: 'Show help overlay',
      group: 'Actions',
      scope: 'global',
    })
    renderModal({ open: false })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('Keyboard Shortcuts')).toBeNull()
    expect(screen.queryByText('Show help overlay')).toBeNull()
  })

  it('renders the dialog, title, and three scope-filter tabs when open', () => {
    seed({
      id: 'g.help',
      keys: ['?'],
      description: 'Show help overlay',
      group: 'Actions',
      scope: 'global',
    })
    renderModal({ open: true })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Keyboard Shortcuts' }),
    ).toBeInTheDocument()

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'All',
      'Global',
      'This page',
    ])
  })

  it('labels the filter tablist descriptively (a11y — not "All")', () => {
    seed({
      id: 'g.help',
      keys: ['?'],
      description: 'Show help overlay',
      group: 'Actions',
      scope: 'global',
    })
    renderModal({ open: true })

    const tablist = screen.getByRole('tablist')
    expect(tablist).toHaveAccessibleName('Filter shortcuts')
    // The default "All" tab is pre-selected.
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('renders registered shortcuts under their group heading with kbd chips', () => {
    seed({
      id: 'g.help',
      keys: ['?'],
      description: 'Show help overlay',
      group: 'Actions',
      scope: 'global',
    })
    renderModal({ open: true })

    // Group heading + description are both visible.
    expect(
      screen.getByRole('heading', { level: 3, name: 'Actions' }),
    ).toBeInTheDocument()
    const key = screen.getByText('?')
    expect(key.tagName).toBe('KBD')
    expect(screen.getByText('Show help overlay')).toBeInTheDocument()
  })

  it('renders a multi-key combo as separate kbd chips joined by "+"', () => {
    seed({
      id: 'g.palette',
      keys: ['Ctrl', 'K'],
      description: 'Command palette',
      group: 'Actions',
      scope: 'global',
    })
    renderModal({ open: true })

    expect(screen.getByText('Ctrl').tagName).toBe('KBD')
    expect(screen.getByText('K').tagName).toBe('KBD')
    // Combo separator only renders between chips (i > 0).
    expect(screen.getByText('+')).toBeInTheDocument()
    expect(document.querySelectorAll('kbd')).toHaveLength(2)
  })

  it('orders groups by priority (navigation before chart) regardless of insertion order', () => {
    // Insert the low-priority group first to prove ordering is by rank, not
    // insertion. GROUP_PRIORITY: navigation=100, chart=40.
    seed(
      {
        id: 'c.zoom',
        keys: ['z'],
        description: 'Zoom chart',
        group: 'Chart',
        scope: 'global',
      },
      {
        id: 'n.home',
        keys: ['g', 'h'],
        description: 'Go home',
        group: 'Navigation',
        scope: 'global',
      },
    )
    renderModal({ open: true })

    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent)
    expect(headings).toEqual(['Navigation', 'Chart'])
  })

  it('orders shortcuts inside a group by id', () => {
    // Register Beta (id b.two) before Alpha (id a.one) — display must be
    // id-sorted, so Alpha comes first.
    seed(
      {
        id: 'b.two',
        keys: ['b'],
        description: 'Beta action',
        group: 'Actions',
        scope: 'global',
      },
      {
        id: 'a.one',
        keys: ['a'],
        description: 'Alpha action',
        group: 'Actions',
        scope: 'global',
      },
    )
    renderModal({ open: true })

    const rows = screen.getAllByText(/^(Alpha action|Beta action)$/)
    expect(rows.map((r) => r.textContent)).toEqual(['Alpha action', 'Beta action'])
  })

  it('filters shortcuts by the debounced search box', async () => {
    seed(
      {
        id: 'g.palette',
        keys: ['Ctrl', 'K'],
        description: 'Command palette',
        group: 'Actions',
        scope: 'global',
      },
      {
        id: 'g.theme',
        keys: ['t'],
        description: 'Toggle theme',
        group: 'Actions',
        scope: 'global',
      },
    )
    renderModal({ open: true })

    expect(screen.getByText('Toggle theme')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search shortcuts…'), {
      target: { value: 'palette' },
    })

    await waitFor(() => {
      expect(screen.queryByText('Toggle theme')).toBeNull()
    })
    expect(screen.getByText('Command palette')).toBeInTheDocument()
  })

  it('shows the empty state when the search matches nothing', async () => {
    seed({
      id: 'g.palette',
      keys: ['Ctrl', 'K'],
      description: 'Command palette',
      group: 'Actions',
      scope: 'global',
    })
    renderModal({ open: true })

    fireEvent.change(screen.getByPlaceholderText('Search shortcuts…'), {
      target: { value: 'zzz-no-match' },
    })

    await waitFor(() => {
      expect(
        screen.getByText('No shortcuts match your search.'),
      ).toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull()
  })

  it('"Global" filter hides page-scoped shortcuts and persists the choice', () => {
    seed(
      {
        id: 'g.help',
        keys: ['?'],
        description: 'Show help overlay',
        group: 'Actions',
        scope: 'global',
      },
      {
        id: 'd.replay',
        keys: ['Space'],
        description: 'Play or pause replay',
        group: 'Replay',
        scope: 'route',
        routeMatch: '/drives/',
      },
    )
    renderModal({ open: true, path: '/drives/42' })

    // Both visible under the default "All" filter.
    expect(screen.getByText('Show help overlay')).toBeInTheDocument()
    expect(screen.getByText('Play or pause replay')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Global' }))

    expect(screen.getByText('Show help overlay')).toBeInTheDocument()
    expect(screen.queryByText('Play or pause replay')).toBeNull()
    expect(sessionStorage.getItem(FILTER_STORAGE_KEY)).toBe('global')
  })

  it('"This page" filter hides global shortcuts and keeps route-scoped ones', () => {
    seed(
      {
        id: 'g.help',
        keys: ['?'],
        description: 'Show help overlay',
        group: 'Actions',
        scope: 'global',
      },
      {
        id: 'd.replay',
        keys: ['Space'],
        description: 'Play or pause replay',
        group: 'Replay',
        scope: 'route',
        routeMatch: '/drives/',
      },
    )
    renderModal({ open: true, path: '/drives/42' })

    fireEvent.click(screen.getByRole('tab', { name: 'This page' }))

    expect(screen.queryByText('Show help overlay')).toBeNull()
    expect(screen.getByText('Play or pause replay')).toBeInTheDocument()
    expect(sessionStorage.getItem(FILTER_STORAGE_KEY)).toBe('page')
  })

  it('hides a route-scoped shortcut whose routeMatch does not match the pathname', () => {
    seed({
      id: 'd.replay',
      keys: ['Space'],
      description: 'Play or pause replay',
      group: 'Replay',
      scope: 'route',
      routeMatch: '/drives/',
    })
    renderModal({ open: true, path: '/charging' })

    expect(screen.queryByText('Play or pause replay')).toBeNull()
    expect(
      screen.getByText('No shortcuts match your search.'),
    ).toBeInTheDocument()
  })

  it('matches a route-scoped shortcut via a RegExp routeMatch', () => {
    seed({
      id: 'd.regex',
      keys: ['r'],
      description: 'Regex-scoped shortcut',
      group: 'Replay',
      scope: 'route',
      routeMatch: /\/drives\/\d+\/replay/,
    })
    renderModal({ open: true, path: '/drives/7/replay' })

    expect(screen.getByText('Regex-scoped shortcut')).toBeInTheDocument()
  })

  it('restores the persisted filter on mount (sessionStorage)', () => {
    sessionStorage.setItem(FILTER_STORAGE_KEY, 'global')
    seed(
      {
        id: 'g.help',
        keys: ['?'],
        description: 'Show help overlay',
        group: 'Actions',
        scope: 'global',
      },
      {
        id: 'd.replay',
        keys: ['Space'],
        description: 'Play or pause replay',
        group: 'Replay',
        scope: 'route',
        routeMatch: '/drives/',
      },
    )
    renderModal({ open: true, path: '/drives/42' })

    // "Global" is the initial selection and the page-scoped entry is hidden.
    expect(screen.getByRole('tab', { name: 'Global' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByText('Show help overlay')).toBeInTheDocument()
    expect(screen.queryByText('Play or pause replay')).toBeNull()
  })

  it('resets the search box when the modal closes and reopens', async () => {
    seed(
      {
        id: 'g.palette',
        keys: ['Ctrl', 'K'],
        description: 'Command palette',
        group: 'Actions',
        scope: 'global',
      },
      {
        id: 'g.theme',
        keys: ['t'],
        description: 'Toggle theme',
        group: 'Actions',
        scope: 'global',
      },
    )
    const onClose = vi.fn()
    const { rerender } = render(
      <MemoryRouter initialEntries={['/']}>
        <KeyboardShortcutsModal open onClose={onClose} />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByPlaceholderText('Search shortcuts…'), {
      target: { value: 'palette' },
    })
    await waitFor(() => {
      expect(screen.queryByText('Toggle theme')).toBeNull()
    })

    // Close then reopen — the search must not bleed across sessions.
    rerender(
      <MemoryRouter initialEntries={['/']}>
        <KeyboardShortcutsModal open={false} onClose={onClose} />
      </MemoryRouter>,
    )
    rerender(
      <MemoryRouter initialEntries={['/']}>
        <KeyboardShortcutsModal open onClose={onClose} />
      </MemoryRouter>,
    )

    expect(screen.getByPlaceholderText('Search shortcuts…')).toHaveValue('')
    expect(screen.getByText('Toggle theme')).toBeInTheDocument()
    expect(screen.getByText('Command palette')).toBeInTheDocument()
  })

  it('renders a keyless definition without crashing (null-safety)', () => {
    seed({
      id: 'g.nokeys',
      keys: undefined as unknown as string[],
      description: 'Keyless shortcut',
      group: 'Actions',
      scope: 'global',
    })
    renderModal({ open: true })

    expect(screen.getByText('Keyless shortcut')).toBeInTheDocument()
    expect(document.querySelectorAll('kbd')).toHaveLength(0)
  })

  it('invokes onClose when the modal close button is clicked', () => {
    seed({
      id: 'g.help',
      keys: ['?'],
      description: 'Show help overlay',
      group: 'Actions',
      scope: 'global',
    })
    const { onClose } = renderModal({ open: true })

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
