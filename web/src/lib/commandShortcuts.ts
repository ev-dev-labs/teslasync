/**
 * Startup-safe mirror of the palette commands that declare a `shortcut` hint.
 *
 * `GlobalShortcuts` (mounted from `<Layout>` at boot) only needs each
 * shortcut command's id, key hint, and translated label — but importing the
 * full {@link commandRegistry} would pin the entire palette (perform
 * closures, keywords, icons, entity-search deps) into the startup bundle.
 * This tiny table carries just the cheatsheet fields so the registry itself
 * stays behind the palette's lazy boundary.
 *
 * DRIFT GUARD: `globalShortcuts.test.tsx` derives its palette-entry
 * expectations from the registry, so adding/removing/retitling a `shortcut`
 * in `commandRegistry.ts` without updating this table fails that suite.
 * Keep the two in sync.
 */
export interface CommandShortcutHint {
  /** Stable command id — matches `CommandDefinition.id`. */
  id: string
  /** Keyboard shortcut hint (display-only, e.g. "T"). */
  shortcut: string
  /** i18n key for the command label. */
  labelKey: string
  /** English fallback shown when the i18n key is missing. */
  labelFallback: string
}

/** One entry per `commandRegistry` command that declares `shortcut`. */
export const COMMAND_SHORTCUTS: readonly CommandShortcutHint[] = [
  {
    id: 'pref.themePicker',
    shortcut: 'T',
    labelKey: 'palette.cmd.themePicker',
    labelFallback: 'Open theme picker',
  },
  {
    id: 'action.shortcuts',
    shortcut: '?',
    labelKey: 'palette.cmd.shortcuts',
    labelFallback: 'Show keyboard shortcuts',
  },
  {
    id: 'action.dashboard.edit',
    shortcut: 'E',
    labelKey: 'palette.cmd.dashboardEdit',
    labelFallback: 'Edit dashboard layout',
  },
]
