// Native parity port of web/src/lib/globalShortcuts.tsx.
//
// The web module is a side-effect-only component, mounted once from `<Layout>`,
// that pours every "global" keyboard shortcut into the shortcut registry so the
// cheatsheet has a single source of truth. It builds three groups of
// informational `ShortcutDefinition`s — the four universal app keys
// (`Ctrl+K`, `/`, `?`, `Esc`), one navigation entry per `GOTO_SHORTCUTS` table
// row (`g` + letter), and one entry per `commandRegistry` command that declares
// a `shortcut` hint — then calls `useShortcut(defs)` and renders nothing
// (`return null`). Three of its inputs are browser-coupled and ported per the
// established native-parity conventions:
//   * react-i18next `useTranslation` is unavailable in native parity, so `t` is
//     replaced by the local `useNativeTranslationFallback()` shim (the
//     PageHeader / RangeSlider / Breadcrumbs precedent) that returns the English
//     fallback copy verbatim and resolves the `{{label}}` interpolation, keeping
//     every i18n key (`shortcuts.*`, `palette.cmd.*`) intact.
//   * `GOTO_SHORTCUTS` is imported from the native `useKeyboardShortcuts` port
//     (all 14 rows preserved byte-for-byte there).
//   * `useShortcut` / `ShortcutDefinition` are imported from the native
//     `useShortcutRegistry` port — a pure-JS external store that runs identically
//     under Hermes, so the registration behaviour is fully preserved (the
//     entries surface on a native cheatsheet via `useAllShortcuts`, and the
//     delegated keydown listener activates on the react-native-web target).
//   * `commandRegistry` (web/src/lib/commandRegistry.ts) is not yet present in
//     the native web-parity tree — it pulls Lucide DOM icon components,
//     react-router `NavigateFunction` types, and `window.dispatchEvent`-based
//     `perform()` handlers — so, following the errorClassification inlining
//     precedent for not-yet-ported dependencies, only the id / labelKey /
//     labelFallback / shortcut fields GlobalShortcuts actually reads are inlined
//     here as `commandShortcutHints`, a faithful projection of
//     `commandRegistry.filter(c => c.shortcut)`. The `.filter(c => c.shortcut)`
//     scan is preserved so the build logic matches the web code path exactly.
//
// Every id (`global.palette.ctrlk`, `global.palette.slash`,
// `global.shortcuts.help`, `global.shortcuts.escape`, `global.goto.<key>`,
// `global.palette.cmd.<id>`), the `keys` tokens, the three translated group
// labels, the `scope: 'global'` on every entry, the `[...universals,
// ...navigation, ...palette]` ordering, the `useMemo(..., [t])` memoisation, and
// the `return null` are all preserved exactly as on web. No DOM elements,
// Recharts, Leaflet, react-router-dom, Lucide icons, or web UI components are
// imported; the only runtime dependency is react plus the two native hook ports.

import {useCallback, useMemo} from 'react';

import {GOTO_SHORTCUTS} from '../hooks/useKeyboardShortcuts';
import {
  useShortcut,
  type ShortcutDefinition,
} from '../hooks/useShortcutRegistry';

// ── Native-safe i18n fallback ────────────────────────────────────────────────
// react-i18next is unavailable in native parity; this shim returns the English
// fallback copy verbatim while preserving the i18n keys and `{{label}}` intent
// (the `t('shortcuts.goto', 'Go to {{label}}', { label })` interpolation call).

type TranslationValues = {label?: string};

type NativeTFunction = (
  key: string,
  fallback: string,
  values?: TranslationValues,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback, values) => {
    if (!values) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
      const value = values[name as keyof TranslationValues];
      return value === undefined ? '' : String(value);
    });
  }, []);
}

// ── Native projection of commandRegistry's shortcut-bearing slice ─────────────
// web/src/lib/commandRegistry.ts is not yet ported to native (it pulls Lucide
// DOM icons, react-router types, and `window` CustomEvent perform handlers), so
// only the fields GlobalShortcuts reads are inlined here. This array is the
// faithful projection of `commandRegistry.filter(c => c.shortcut)` — the three
// default commands that declare a `shortcut` hint, copied verbatim.

interface CommandShortcutHint {
  id: string;
  labelKey: string;
  labelFallback: string;
  shortcut?: string;
}

const commandShortcutHints: CommandShortcutHint[] = [
  {
    id: 'pref.themePicker',
    labelKey: 'palette.cmd.themePicker',
    labelFallback: 'Open theme picker',
    shortcut: 'T',
  },
  {
    id: 'action.shortcuts',
    labelKey: 'palette.cmd.shortcuts',
    labelFallback: 'Show keyboard shortcuts',
    shortcut: '?',
  },
  {
    id: 'action.dashboard.edit',
    labelKey: 'palette.cmd.dashboardEdit',
    labelFallback: 'Edit dashboard layout',
    shortcut: 'E',
  },
];

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
 *   3. Every command that declares a `shortcut` hint (e.g., `T` → toggle theme).
 *      Registered informationally; the palette command itself owns the actual
 *      key handling once the user activates it via the palette. (Sourced from
 *      `commandShortcutHints`, the native projection of `commandRegistry`'s
 *      shortcut-bearing slice — see the note above.)
 *
 * Returns nothing visible — its only job is to populate the registry.
 */
export function GlobalShortcuts(): null {
  const t = useNativeTranslationFallback();

  const defs = useMemo<ShortcutDefinition[]>(() => {
    const groupActions = t('shortcuts.groups.actions', 'Actions');
    const groupNavigation = t(
      'shortcuts.groups.navigation',
      'Navigation (press g then…)',
    );
    const groupCommands = t('shortcuts.groups.commands', 'Commands');

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
    ];

    const navigation: ShortcutDefinition[] = Object.entries(GOTO_SHORTCUTS).map(
      ([key, target]): ShortcutDefinition => ({
        id: `global.goto.${key}`,
        keys: ['g', key],
        description: t('shortcuts.goto', 'Go to {{label}}', {
          label: target.label,
        }),
        group: groupNavigation,
        scope: 'global',
      }),
    );

    const palette: ShortcutDefinition[] = commandShortcutHints
      .filter(c => c.shortcut)
      .map(
        (c): ShortcutDefinition => ({
          id: `global.palette.cmd.${c.id}`,
          keys: [c.shortcut as string],
          description: t(c.labelKey, c.labelFallback),
          group: groupCommands,
          scope: 'global',
        }),
      );

    return [...universals, ...navigation, ...palette];
  }, [t]);

  useShortcut(defs);
  return null;
}
