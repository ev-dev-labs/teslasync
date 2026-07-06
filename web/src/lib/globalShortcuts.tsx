import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { GOTO_SHORTCUTS } from '@/hooks/useKeyboardShortcuts'
import { useShortcut, type ShortcutDefinition } from '@/hooks/useShortcutRegistry'
import { commandRegistry, type CommandDefinition } from '@/lib/commandRegistry'

/**
 * Registers global shortcuts.
 *
 * Mounted once from `<Layout>`. Pours every "global" shortcut into the
 * registry so the cheatsheet has a single source of truth:
 *
 *   1. The four universal app keys: `?`, `Ctrl+K`, `/`, `Esc`.
 *   2. Every entry in {@link GOTO_SHORTCUTS} (the `g + letter` navigation
 *      table). Registered as informational entries — the actual `g`-mode
 *      handling stays in `useKeyboardShortcuts` because it owns the timed
 *      two-key sequence state machine.
 *   3. Every {@link commandRegistry} entry that declares a `shortcut` hint
 *      (e.g., `T` → toggle theme). Registered informationally; the palette
 *      command itself owns the actual key handling once the user activates
 *      it via the palette.
 *
 * Returns nothing visible — its only job is to populate the registry.
 */
export function GlobalShortcuts(): null {
  const { t } = useTranslation()

  const defs = useMemo<ShortcutDefinition[]>(() => {
    const groupActions = t('shortcuts.groups.actions', 'Actions')
    const groupNavigation = t('shortcuts.groups.navigation', 'Navigation (press g then…)')
    const groupCommands = t('shortcuts.groups.commands', 'Commands')

    const universals: ShortcutDefinition[] = [
      {
        id: 'global.palette.ctrlk',
        keys: ['Ctrl', 'K'],
        description: t('shortcuts.openPalette', 'Open command palette'),
        group: groupActions,
        scope: 'global',
      },
      {
        id: 'global.palette.slash',
        keys: ['/'],
        description: t('shortcuts.openPaletteAlt', 'Open command palette'),
        group: groupActions,
        scope: 'global',
      },
      {
        id: 'global.shortcuts.help',
        keys: ['?'],
        description: t('shortcuts.openShortcuts', 'Show keyboard shortcuts'),
        group: groupActions,
        scope: 'global',
      },
      {
        id: 'global.shortcuts.escape',
        keys: ['Esc'],
        description: t('shortcuts.close', 'Close modal / cancel'),
        group: groupActions,
        scope: 'global',
      },
    ]

    const navigation: ShortcutDefinition[] = Object.entries(GOTO_SHORTCUTS).map(
      ([key, target]): ShortcutDefinition => ({
        id: `global.goto.${key}`,
        keys: ['g', key],
        description: t('shortcuts.goto', 'Go to {{label}}', { label: target.label }),
        group: groupNavigation,
        scope: 'global',
      }),
    )

    const palette: ShortcutDefinition[] = commandRegistry
      .filter((c): c is CommandDefinition & { shortcut: string } => Boolean(c.shortcut))
      .map(
        (c): ShortcutDefinition => ({
          id: `global.palette.cmd.${c.id}`,
          keys: [c.shortcut],
          description: t(c.labelKey, c.labelFallback),
          group: groupCommands,
          scope: 'global',
        }),
      )

    return [...universals, ...navigation, ...palette]
  }, [t])

  useShortcut(defs)
  return null
}
