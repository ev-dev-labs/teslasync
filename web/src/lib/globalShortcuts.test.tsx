/**
 * globalShortcuts — the invisible seed component mounted once from <Layout>.
 *
 * It renders nothing; its only job is to pour three families of entries into
 * the shortcut registry so the cheatsheet has a single source of truth:
 *   1. four universal action keys (Ctrl+K, /, ?, Esc),
 *   2. one navigation entry per {@link GOTO_SHORTCUTS} (`g` then a letter),
 *   3. one palette entry per {@link commandRegistry} command that declares a
 *      `shortcut` hint.
 *
 * Every entry is registered *informationally* (no `handler`/`match`) — the real
 * key handling lives in useKeyboardShortcuts / the palette. These tests pin that
 * contract plus the id/keys/scope/description shape of each family.
 *
 * react-i18next is mocked to echo the English fallback AND interpolate
 * `{{token}}` placeholders so navigation descriptions ("Go to Dashboard") are
 * deterministic. No Router is needed: GlobalShortcuts only touches
 * useTranslation + useShortcut, and we read the registry back through
 * useAllShortcuts (which is scope-agnostic and router-free).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, renderHook, cleanup } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, opts?: Record<string, unknown>) => {
      let out = fallback ?? _key
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v))
        }
      }
      return out
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

import { GlobalShortcuts } from './globalShortcuts'
import { GOTO_SHORTCUTS } from '@/hooks/useKeyboardShortcuts'
import { commandRegistry } from '@/lib/commandRegistry'
import {
  useAllShortcuts,
  _resetShortcutRegistry,
  type ShortcutDefinition,
} from '@/hooks/useShortcutRegistry'

const UNIVERSAL_IDS = [
  'global.palette.ctrlk',
  'global.palette.slash',
  'global.shortcuts.help',
  'global.shortcuts.escape',
] as const

const gotoKeys = Object.keys(GOTO_SHORTCUTS)
const shortcutCommands = commandRegistry.filter((c) => c.shortcut)
const EXPECTED_TOTAL = UNIVERSAL_IDS.length + gotoKeys.length + shortcutCommands.length

/** Read the current registry snapshot without needing a Router. */
function readAll(): ShortcutDefinition[] {
  let snap: ShortcutDefinition[] = []
  const { unmount } = renderHook(() => {
    snap = useAllShortcuts()
  })
  unmount()
  return snap
}

function byId(all: ShortcutDefinition[], id: string): ShortcutDefinition | undefined {
  return all.find((d) => d.id === id)
}

/** Mount the seed once, then return the entries it registered. */
function renderAndRead(): ShortcutDefinition[] {
  render(<GlobalShortcuts />)
  return readAll()
}

afterEach(() => {
  cleanup()
  _resetShortcutRegistry()
})

describe('GlobalShortcuts', () => {
  it('renders nothing visible but populates the registry as a side effect', () => {
    const { container } = render(<GlobalShortcuts />)

    // The component returns null — no DOM footprint at all.
    expect(container.firstChild).toBeNull()
    expect(container.childNodes).toHaveLength(0)

    // ...yet the registry is now seeded with the full union of entries.
    const all = readAll()
    expect(all).toHaveLength(EXPECTED_TOTAL)
    expect(all.length).toBeGreaterThan(0)
  })

  it('registers the four universal action shortcuts with correct keys, group and scope', () => {
    const all = renderAndRead()

    const ctrlk = byId(all, 'global.palette.ctrlk')
    expect(ctrlk).toBeDefined()
    expect(ctrlk?.keys).toEqual(['Ctrl', 'K'])
    expect(ctrlk?.group).toBe('Actions')
    expect(ctrlk?.scope).toBe('global')
    expect(ctrlk?.description).toBe('Open command palette')

    expect(byId(all, 'global.palette.slash')?.keys).toEqual(['/'])
    expect(byId(all, 'global.shortcuts.help')?.keys).toEqual(['?'])
    expect(byId(all, 'global.shortcuts.help')?.description).toBe('Show keyboard shortcuts')
    expect(byId(all, 'global.shortcuts.escape')?.keys).toEqual(['Esc'])
    expect(byId(all, 'global.shortcuts.escape')?.description).toBe('Close modal / cancel')

    // All four universals are present and share the Actions group.
    for (const id of UNIVERSAL_IDS) {
      expect(byId(all, id)?.group).toBe('Actions')
    }
  })

  it('registers one navigation entry per GOTO_SHORTCUTS with `g`+key and an interpolated label', () => {
    const all = renderAndRead()
    const navEntries = all.filter((d) => d.id.startsWith('global.goto.'))

    expect(navEntries).toHaveLength(gotoKeys.length)

    const dash = byId(all, 'global.goto.d')
    expect(dash).toBeDefined()
    expect(dash?.keys).toEqual(['g', 'd'])
    expect(dash?.description).toBe('Go to Dashboard')
    expect(dash?.group).toBe('Navigation (press g then…)')
    expect(dash?.scope).toBe('global')

    // Every navigation entry interpolated its {{label}} placeholder and keeps
    // the two-token `g`+letter shape.
    for (const entry of navEntries) {
      expect(entry.description).not.toContain('{{')
      expect(entry.description.startsWith('Go to ')).toBe(true)
      expect(entry.keys).toHaveLength(2)
      expect(entry.keys[0]).toBe('g')
    }
  })

  it('registers a palette entry for every command that declares a shortcut (and none for those without)', () => {
    const all = renderAndRead()
    const paletteEntries = all.filter((d) => d.id.startsWith('global.palette.cmd.'))

    expect(paletteEntries).toHaveLength(shortcutCommands.length)
    expect(shortcutCommands.length).toBeGreaterThan(0)

    for (const c of shortcutCommands) {
      const entry = byId(all, `global.palette.cmd.${c.id}`)
      expect(entry).toBeDefined()
      expect(entry?.keys).toEqual([c.shortcut])
      expect(entry?.description).toBe(c.labelFallback)
      expect(entry?.group).toBe('Commands')
    }

    // A command with no `shortcut` hint must NOT be surfaced here.
    const noShortcut = commandRegistry.find((c) => !c.shortcut)
    expect(noShortcut).toBeDefined()
    expect(byId(all, `global.palette.cmd.${noShortcut?.id}`)).toBeUndefined()
  })

  it('marks every entry global-scoped and informational (no handler/match)', () => {
    const all = renderAndRead()

    expect(all.length).toBeGreaterThan(0)
    for (const entry of all) {
      expect(entry.scope).toBe('global')
      // Informational only — the g-mode state machine and palette own the real
      // key handling, so the seed must never attach a delegated handler.
      expect(entry.handler).toBeUndefined()
      expect(entry.match).toBeUndefined()
    }
  })

  it('assigns unique ids across all three families', () => {
    const all = renderAndRead()
    const ids = all.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('global.palette.ctrlk')
    expect(ids).toContain('global.goto.d')
  })

  it('removes all of its entries from the registry on unmount', () => {
    const { unmount } = render(<GlobalShortcuts />)
    expect(readAll()).toHaveLength(EXPECTED_TOTAL)

    unmount()

    // The useShortcut cleanup unregisters exactly the ids it registered,
    // leaving the registry empty for the next consumer.
    expect(readAll()).toHaveLength(0)
  })
})
