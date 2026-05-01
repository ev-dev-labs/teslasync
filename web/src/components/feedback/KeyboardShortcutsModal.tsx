import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/ui'
import { GOTO_SHORTCUTS } from '@/hooks/useKeyboardShortcuts'
import { commandRegistry } from '@/lib/commandRegistry'

/**
 * KeyboardShortcutsModal — Phase 40 / Prompt 19.
 *
 * Single source of truth for the "?" cheat sheet. Pulls from three places:
 *   1. {@link GOTO_SHORTCUTS} — "g + key" navigation table from useKeyboardShortcuts
 *   2. {@link commandRegistry} — every entry whose `shortcut` is defined
 *   3. A small hardcoded "Global" list — Ctrl+K / Esc / "/" — that never lives in
 *      the registry because it's how the palette itself is opened/closed.
 *
 * Replaces the older KeyboardCheatSheet component. The modal is opened by the
 * `?` key (handled by useKeyboardShortcuts) or by the
 * `toggle-keyboard-shortcuts` custom event (dispatched by the palette's
 * "Show keyboard shortcuts" command).
 */

interface Shortcut {
  keys: string[]
  description: string
}

interface ShortcutGroup {
  title: string
  shortcuts: Shortcut[]
}

interface KeyboardShortcutsModalProps {
  open: boolean
  onClose: () => void
}

export function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  const { t } = useTranslation()

  const groups = useMemo<ShortcutGroup[]>(() => {
    const global: ShortcutGroup = {
      title: t('shortcuts.group.global', 'Global'),
      shortcuts: [
        { keys: ['Ctrl', 'K'], description: t('shortcuts.openPalette', 'Open command palette') },
        { keys: ['/'], description: t('shortcuts.openPaletteAlt', 'Open command palette') },
        { keys: ['?'], description: t('shortcuts.openShortcuts', 'Show keyboard shortcuts') },
        { keys: ['Esc'], description: t('shortcuts.close', 'Close modal / cancel') },
      ],
    }

    const navigation: ShortcutGroup = {
      title: t('shortcuts.group.navigation', 'Navigation (press g then…)'),
      shortcuts: Object.entries(GOTO_SHORTCUTS).map(([key, target]) => ({
        keys: ['g', key],
        description: t('shortcuts.goto', 'Go to {{label}}', { label: target.label }),
      })),
    }

    // Commands that have an explicit `shortcut` field — we display the raw
    // string as a single key chip so multi-key sequences ("g d", "⌘K") render
    // sensibly without us trying to parse them.
    const registryShortcuts: Shortcut[] = commandRegistry
      .filter((c) => c.shortcut)
      .map((c) => ({
        keys: [c.shortcut as string],
        description: t(c.labelKey, c.labelFallback),
      }))

    const result: ShortcutGroup[] = [global, navigation]
    if (registryShortcuts.length > 0) {
      result.push({
        title: t('shortcuts.group.commands', 'Commands'),
        shortcuts: registryShortcuts,
      })
    }
    return result
  }, [t])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('shortcuts.title', 'Keyboard Shortcuts')}
    >
      <div className="space-y-6 max-h-[70vh] overflow-y-auto">
        {groups.map((group) => (
          <section key={group.title}>
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">
              {group.title}
            </h3>
            <div className="space-y-1.5">
              {group.shortcuts.map((s) => (
                <div
                  key={`${group.title}-${s.description}-${s.keys.join('-')}`}
                  className="flex items-center justify-between py-1"
                >
                  <span className="text-sm text-[var(--text-secondary)]">{s.description}</span>
                  <div className="flex items-center gap-1">
                    {s.keys.map((key, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && (
                          <span className="text-[var(--text-muted)] text-xs">+</span>
                        )}
                        <kbd
                          className="px-2 py-0.5 rounded bg-[var(--surface-2)] border border-[var(--glass-border)]
                            text-xs font-mono text-[var(--text-secondary)] min-w-[24px] text-center"
                        >
                          {key}
                        </kbd>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  )
}
