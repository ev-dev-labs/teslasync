// Native parity port of web/src/features/dashboard/hooks/useLayoutKeyboard.ts.
//
// The web module is a non-visual behaviour hook (rule 6: port the logic/types
// faithfully). It wires the dashboard's keyboard shortcuts —
//   • `E`               -> toggle edit mode
//   • `Esc`             -> exit edit mode
//   • `?` / `Shift+/`   -> open the keyboard-shortcuts help overlay
//   • `Ctrl/Cmd+Z / +Y` -> undo / redo while in edit mode
//   • `Alt+1..9`        -> switch between dashboards
// — skipping events whose focus target is a form input
// (INPUT/TEXTAREA/SELECT/contenteditable), and *also* publishes the
// page-scoped entries to the cheatsheet registry so the `?` overlay lists them
// under "Dashboard".
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation (web L2) -> a local English-fallback
//     useTranslation() whose t(key, fallback?, values?) returns the fallback
//     and interpolates {{token}} placeholders, preserving every translation key
//     verbatim. Matches the KioskOverlay / RecentlyViewedWidget precedent.
//   • `../widgets/types` SavedDashboard (web L3) -> the SavedDashboard type
//     chain inlined verbatim (WidgetConfig / WidgetInstance / RGLLayout /
//     RGLLayouts / DashboardSettings); none of those carry DOM or lucide-react
//     deps. widgets/types.ts is not yet ported, so inlining keeps this a
//     single-file conversion (the established native precedent for unported
//     local dependencies). The hook itself only reads dashboards.length and
//     dashboards[n].id, exactly as the web hook does.
//   • `@/hooks/useShortcutRegistry` useShortcut + ShortcutDefinition (web L4) ->
//     a native-safe in-memory registry inlined below. Only the register /
//     unregister *lifecycle* the web hook exercises is ported; the web
//     registry's useSyncExternalStore subscription, react-router useLocation
//     scope filtering, and the single delegated `document` keydown listener are
//     browser-only and are NOT exercised by this hook (its definitions are
//     informational — no `match` / `handler`), so they are intentionally
//     omitted. The KeyboardEvent-typed `match` / `handler` fields are retyped
//     against the DOM-free ShortcutKeyEvent shape for parity.
//   • `window.addEventListener('keydown', ...)` (web L70-124) is browser-only.
//     React Native phones expose no global hardware-keyboard keydown stream, so
//     getKeyboardEventTarget() feature-detects a global event target and, when
//     none exists (the native default), the effect is a documented no-op —
//     the explicit "unavailable" state required by rule 7, surfaced via the
//     exported isKeyboardEventTargetAvailable(). The full key-handling logic is
//     preserved 1:1 in the exported, testable createDashboardKeydownHandler so
//     a future desktop/keyboard host (or RN-Web) wires it up unchanged.
//   • `window.dispatchEvent(new CustomEvent('toggle-keyboard-shortcuts'))`
//     (web L103) -> emitToggleKeyboardShortcuts(), a DOM-free module-level
//     signal hub mirroring the web global event; subscribers attach via
//     subscribeToggleKeyboardShortcuts().
// No DOM elements, window/document, KeyboardEvent/HTMLElement/CustomEvent,
// react-i18next, react-router-dom, Recharts, Leaflet, framer-motion, react-dom,
// or web UI-kit modules are imported into the native output.

import {useCallback, useEffect, useMemo, useRef} from 'react';

/* ─── i18n fallback (web react-i18next useTranslation) ─────────────────── */

type TranslationValues = Record<string, string | number>;

type TFunc = (
  key: string,
  fallback?: string,
  values?: TranslationValues,
) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site and interpolating {{token}} placeholders.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback, values) => {
    const base = fallback ?? key;
    if (!values) {
      return base;
    }
    return base.replace(/\{\{(\w+)\}\}/g, (match, token: string) =>
      values[token] === undefined ? match : String(values[token]),
    );
  }, []);
  return {t};
}

/* ─── inlined ../widgets/types SavedDashboard chain ────────────────────── */

export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

export interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

export interface WidgetInstance {
  id: string;
  widgetId: string;
  config?: WidgetConfig;
}

/** react-grid-layout Layout item (position + size in grid units) */
export interface RGLLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean;
  isDraggable?: boolean;
  isResizable?: boolean;
  moved?: boolean;
}

/** react-grid-layout Layouts — keyed by breakpoint string */
export interface RGLLayouts {
  [breakpoint: string]: RGLLayout[];
}

export interface DashboardSettings {
  /** Auto-refresh interval in seconds (0 = use per-widget default) */
  refreshInterval: number;
  /** Filter widgets to show only this vehicle (undefined = all vehicles) */
  vehicleId?: number;
  /** Show widget borders in view mode */
  showWidgetBorders: boolean;
  /** Compact mode — reduces grid gaps */
  compactMode: boolean;
}

export interface SavedDashboard {
  id: string;
  name: string;
  icon?: string;
  /**
   * Optional per-vehicle scope.
   *   undefined / null → applies to ALL vehicles ("user-global").
   *   number           → pinned to that vehicle id; switcher hides this
   *                      layout when a different vehicle is selected.
   */
  vehicleId?: number | null;
  widgets: WidgetInstance[];
  layouts: RGLLayouts;
  createdAt: string;
  updatedAt: string;
  isDefault?: boolean;
  settings?: DashboardSettings;
}

/* ─── native-safe keyboard event shape (web DOM KeyboardEvent subset) ──── */

// The DOM-free structural subset of KeyboardEvent the dashboard handler reads. A
// real DOM KeyboardEvent is structurally assignable to this where a keyboard
// host exists, so the handler logic stays identical to the web version.
export interface ShortcutKeyEventTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

export interface ShortcutKeyEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  target?: ShortcutKeyEventTarget | null;
  preventDefault: () => void;
}

/* ─── native-safe shortcut registry (web @/hooks/useShortcutRegistry) ──── */

export type ShortcutScope = 'global' | 'route' | 'page';

export interface ShortcutDefinition {
  /** Stable id, also used as the cheatsheet React key + dedupe key. */
  id: string;
  /** Key combination as an array of display-only label tokens, e.g. `['?']`. */
  keys: string[];
  /** Already-translated description shown in the cheatsheet. */
  description: string;
  /** Group the shortcut renders under in the cheatsheet (already translated). */
  group: string;
  /** Scope determines visibility in the cheatsheet. */
  scope: ShortcutScope;
  /** Required when scope is `'route'` or `'page'`. Pathname prefix or regex. */
  routeMatch?: string | RegExp;
  /** Optional native keyboard predicate (informational entries omit it). */
  match?: (event: ShortcutKeyEvent) => boolean;
  /** Optional callback; informational entries omit it and wire their own. */
  handler?: (event: ShortcutKeyEvent) => void;
  /** Priority for resolving multiple matching definitions. Higher wins. */
  priority?: number;
  /** Fire even when focus is inside a form input / contenteditable. */
  allowInInput?: boolean;
}

// Module-level registry. The web version layers a useSyncExternalStore snapshot
// + a single delegated `document` keydown listener on top of this map; neither
// is exercised by useLayoutKeyboard (its entries are informational), and both
// are browser-only, so the native port keeps just the register/unregister
// lifecycle the hook depends on.
const shortcutRegistry = new Map<string, ShortcutDefinition>();

/** Imperative register. Exported for the global seed and tests. */
export function registerShortcut(def: ShortcutDefinition): void {
  shortcutRegistry.set(def.id, def);
}

export function unregisterShortcut(id: string): void {
  shortcutRegistry.delete(id);
}

/** Read every registered shortcut (snapshot copy). */
export function getRegisteredShortcuts(): ShortcutDefinition[] {
  return Array.from(shortcutRegistry.values());
}

/** Test helper — wipe the registry. Not for production use. */
export function _resetShortcutRegistry(): void {
  shortcutRegistry.clear();
}

/** Stable cache key derived from definitions (id + scope + route + keys). */
function stableKey(defs: ShortcutDefinition | ShortcutDefinition[]): string {
  const arr = Array.isArray(defs) ? defs : [defs];
  return arr
    .map(d => `${d.id}|${d.scope}|${String(d.routeMatch ?? '')}|${d.keys.join('+')}`)
    .join('\n');
}

/**
 * Register one or more shortcut definitions for the lifetime of the calling
 * component. Strict-mode safe: definitions are deduped by `id`, so React 18's
 * mount → cleanup → mount sequence ends with the same final state as a single
 * mount. The `defs` argument is intentionally NOT in the dep array — a
 * serialised stable key is used instead so callers can pass freshly-built
 * arrays each render without re-registering on every tick.
 */
export function useShortcut(
  defs: ShortcutDefinition | ShortcutDefinition[],
): void {
  // Serialised stable key so callers can pass freshly-built arrays each render
  // without re-registering on every tick (the web hook's design). The effect is
  // driven off this primitive, not the array identity.
  const key = stableKey(defs);
  const list = Array.isArray(defs) ? defs : [defs];

  // Hold the latest list so the key-driven effect registers the current entries
  // while cleanup still unregisters exactly the ids it registered.
  const listRef = useRef<ShortcutDefinition[]>(list);
  listRef.current = list;

  useEffect(() => {
    const ids = listRef.current.map(d => d.id);
    listRef.current.forEach(registerShortcut);
    return () => {
      ids.forEach(unregisterShortcut);
    };
  }, [key]);
}

/* ─── native-safe "toggle keyboard shortcuts" signal (web CustomEvent) ─── */

type ToggleShortcutsListener = () => void;

const toggleShortcutsListeners = new Set<ToggleShortcutsListener>();

/**
 * Subscribe to the "open keyboard-shortcuts overlay" signal. Native stand-in
 * for the web `window.addEventListener('toggle-keyboard-shortcuts', ...)` —
 * returns an unsubscribe function.
 */
export function subscribeToggleKeyboardShortcuts(
  listener: ToggleShortcutsListener,
): () => void {
  toggleShortcutsListeners.add(listener);
  return () => {
    toggleShortcutsListeners.delete(listener);
  };
}

/**
 * Fire the "open keyboard-shortcuts overlay" signal. Native stand-in for the web
 * `window.dispatchEvent(new CustomEvent('toggle-keyboard-shortcuts'))`.
 */
export function emitToggleKeyboardShortcuts(): void {
  toggleShortcutsListeners.forEach(listener => {
    listener();
  });
}

/* ─── native-safe keydown source (web window keydown stream) ───────────── */

interface KeydownEventTarget {
  addEventListener: (
    type: 'keydown',
    handler: (event: ShortcutKeyEvent) => void,
  ) => void;
  removeEventListener: (
    type: 'keydown',
    handler: (event: ShortcutKeyEvent) => void,
  ) => void;
}

// Feature-detect a global event target that speaks keydown. On a React Native
// phone there is none, so this returns null and the hook's listener effect is a
// documented no-op (rule 7). A future desktop / RN-Web host that exposes a
// global addEventListener wires the unchanged handler up automatically.
function getKeyboardEventTarget(): KeydownEventTarget | null {
  const g = globalThis as unknown as {
    addEventListener?: unknown;
    removeEventListener?: unknown;
  };
  if (
    typeof g.addEventListener === 'function' &&
    typeof g.removeEventListener === 'function'
  ) {
    return g as unknown as KeydownEventTarget;
  }
  return null;
}

/**
 * Whether a global keydown source is available in the current runtime. `false`
 * on a stock React Native phone (no hardware-keyboard keydown stream) — the
 * explicit "unavailable" state for the web keydown wiring.
 */
export function isKeyboardEventTargetAvailable(): boolean {
  return getKeyboardEventTarget() !== null;
}

/* ─── the hook ─────────────────────────────────────────────────────────── */

export interface KeyboardOptions {
  editMode: boolean;
  setEditMode: (next: boolean) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  dashboards: SavedDashboard[];
  switchDashboard: (id: string) => void;
}

/**
 * Build the dashboard keydown handler. Extracted (and exported) so the full web
 * key-handling logic stays testable without a DOM, then attached to whatever
 * keydown source the runtime provides (none on a stock phone — see
 * isKeyboardEventTargetAvailable).
 */
export function createDashboardKeydownHandler(
  options: KeyboardOptions,
): (event: ShortcutKeyEvent) => void {
  const {
    editMode,
    setEditMode,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    dashboards,
    switchDashboard,
  } = options;

  return (e: ShortcutKeyEvent) => {
    const target = e.target;
    const tag = target?.tagName;
    if (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      target?.isContentEditable === true
    ) {
      return;
    }

    // Alt+1..9 — switch dashboards
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9 && num <= dashboards.length) {
        e.preventDefault();
        switchDashboard(dashboards[num - 1].id);
        return;
      }
    }

    // Bare keys (no modifiers) — toggle edit / help / exit
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === 'e' || e.key === 'E') {
        if (e.shiftKey) {
          return;
        }
        e.preventDefault();
        setEditMode(!editMode);
        return;
      }
      if (e.key === 'Escape' && editMode) {
        e.preventDefault();
        setEditMode(false);
        return;
      }
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        emitToggleKeyboardShortcuts();
        return;
      }
    }

    // Undo/Redo (edit mode only)
    if (!editMode) {
      return;
    }
    const isCtrlOrMeta = e.ctrlKey || e.metaKey;
    if (!isCtrlOrMeta) {
      return;
    }

    if (e.key === 'z' && !e.shiftKey && canUndo) {
      e.preventDefault();
      onUndo();
    } else if ((e.key === 'y' || (e.key === 'z' && e.shiftKey)) && canRedo) {
      e.preventDefault();
      onRedo();
    }
  };
}

/**
 * Keyboard shortcuts for the dashboard. Registers the page-scoped cheatsheet
 * entries (so `?` lists them under "Dashboard") and, when the runtime exposes a
 * keydown source, wires the live handler. On a stock React Native phone no such
 * source exists, so only the cheatsheet registration runs (see the module
 * header for the rule-7 unavailable-state rationale).
 */
export function useLayoutKeyboard({
  editMode,
  setEditMode,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  dashboards,
  switchDashboard,
}: KeyboardOptions) {
  const {t} = useTranslation();

  const dashboardShortcuts = useMemo<ShortcutDefinition[]>(() => {
    const group = t('shortcuts.groups.dashboard', 'Dashboard');
    const make = (
      id: string,
      keys: string[],
      description: string,
    ): ShortcutDefinition => ({
      id: `dashboard.${id}`,
      keys,
      description,
      group,
      scope: 'route',
      routeMatch: /^\/$/,
    });
    const base: ShortcutDefinition[] = [
      make('toggleEdit', ['E'], t('dashboard.shortcuts.toggleEdit', 'Toggle edit mode')),
    ];
    if (editMode) {
      base.push(
        make('exitEdit', ['Esc'], t('dashboard.shortcuts.exitEdit', 'Exit edit mode')),
        make('undo', ['Ctrl', 'Z'], t('dashboard.shortcuts.undo', 'Undo layout change')),
        make('redo', ['Ctrl', 'Y'], t('dashboard.shortcuts.redo', 'Redo layout change')),
      );
    }
    if (dashboards.length > 1) {
      base.push(
        make('switch', ['Alt', '1–9'], t('dashboard.shortcuts.switch', 'Switch between dashboards')),
      );
    }
    return base;
  }, [editMode, dashboards.length, t]);
  useShortcut(dashboardShortcuts);

  useEffect(() => {
    const handler = createDashboardKeydownHandler({
      editMode,
      setEditMode,
      canUndo,
      canRedo,
      onUndo,
      onRedo,
      dashboards,
      switchDashboard,
    });

    const target = getKeyboardEventTarget();
    if (!target) {
      // Native: no global hardware-keyboard keydown stream. Explicit
      // unavailable state (rule 7) — the cheatsheet entries are registered
      // above, but there is nothing to listen on, so this is a no-op.
      return undefined;
    }

    target.addEventListener('keydown', handler);
    return () => {
      target.removeEventListener('keydown', handler);
    };
  }, [editMode, setEditMode, canUndo, canRedo, onUndo, onRedo, dashboards, switchDashboard]);
}
