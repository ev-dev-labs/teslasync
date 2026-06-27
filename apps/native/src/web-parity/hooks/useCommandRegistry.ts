// Native parity port of web/src/hooks/useCommandRegistry.ts.
//
// The web hook resolves the static command-palette registry against live React
// context (navigate, theme, toast, queryClient, selected-vehicle, i18n) and
// returns `commands` (ready-to-render palette items), `getById(id)`, and
// `filter(query)` (fuzzy score + sort). Seven of its inputs are browser- or
// web-app-coupled and are ported per the established native-parity conventions:
//
//   * react-router-dom `useNavigate()` is browser-only — replaced by an optional
//     `onNavigate(path)` callback (the useKeyboardShortcuts / Breadcrumbs
//     injected-navigation precedent). When omitted it is an inert no-op (mobile
//     navigation is driven by a navigator, not the registry).
//   * `@/components/ui/ThemeProvider` `useTheme()` (`setMode` / `setTheme`) is
//     not ported — replaced by optional `setMode` / `setTheme` callbacks; inert
//     no-ops when omitted. `ModeId` / `ThemeId` are inlined from ThemeProvider.
//   * `@/store/selectedVehicle` `useSelectedVehicleStore()` (`setVehicleId`) is
//     not ported — replaced by an optional `setVehicleId` callback; inert no-op
//     when omitted.
//   * react-i18next `useTranslation()` is unavailable in native parity — replaced
//     by a local `defaultTranslate` shim (the VehiclePicker / globalShortcuts
//     precedent) that returns the English fallback copy and resolves `{{var}}`
//     interpolation, keeping every i18n key intact. A caller can inject a real
//     `t`.
//   * `@/components/feedback/Toast` `useToast()` is not ported — the default
//     toast routes success/error/info through React Native `Alert.alert` (the
//     api/hooks `_toastHelpers` precedent). A caller can inject a real toast.
//   * `@tanstack/react-query` `useQueryClient()` IS a native dependency, so
//     `invalidateAll` is ported 1:1 (`await queryClient.invalidateQueries()`).
//   * `@/lib/commandRegistry` (commandRegistry + scoreCommand + types) is not yet
//     present in the native web-parity tree — it pulls Lucide DOM icon
//     components, react-router `NavigateFunction` types, `window.dispatchEvent`
//     CustomEvent `perform()` handlers, `document.documentElement.classList`, and
//     `@/lib/commandFrecency`. Following the globalShortcuts / errorClassification
//     inlining precedent for not-yet-ported dependencies, the full registry,
//     `scoreCommand`, and the `CommandContext` / `CommandDefinition` /
//     `CommandSection` types are inlined here as a faithful projection. The Lucide
//     icon *component* becomes a stable icon-name string (`CommandIcon`); the
//     `window.dispatchEvent(new CustomEvent(name))` handlers route through the
//     native-safe `dispatchAppEvent()` facade (a real `window` on the
//     react-native-web target preserves the byte-for-byte event names; pure
//     native no-ops); `document.documentElement.classList.contains('dark')`
//     becomes the `isDarkMode()` document facade (defaults to dark off-DOM); and
//     `_resetFrecency()` becomes `resetFrecencyStorage()` (a `globalThis`
//     localStorage facade removing the same `teslasync:cmd-frecency:v1` key).
//
// The public surface (`ResolvedCommand`, `useCommandRegistry`), every state name
// (commands / getById / filter), all command ids / labelKeys / labelFallbacks /
// sections / keywords / shortcuts, the `source: 'registry'` tag, the
// `{ commands, getById, filter }` return shape, the `t(labelKey, labelFallback)`
// label resolution, the `invoke: () => def.perform(ctx)` wiring, and the
// scoreCommand heuristics are all preserved exactly as on web. `useCommandRegistry()`
// stays callable with zero arguments (the web call site); native handles are
// injected via the optional options object. Browser unavailability is surfaced
// via `nativeCommandRegistryCapabilities` and the parity sidecar. No DOM
// elements, Recharts, Leaflet, react-router-dom, react-i18next, Lucide icons, or
// web UI components are imported; the only runtime dependencies are react,
// @tanstack/react-query, and react-native (Alert).

import {useCallback, useMemo} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {Alert} from 'react-native';

/* ------------------------------------------------------------------ */
/*  Inlined ThemeProvider unit types (web @/components/ui/ThemeProvider) */
/* ------------------------------------------------------------------ */

/** Mode ids accepted by `setMode`. Inlined from the web ThemeProvider. */
export type ModeId =
  | 'dark'
  | 'light'
  | 'oled'
  | 'midnight'
  | 'auto'
  | 'sunset'
  | 'nord';

/** Theme ids accepted by `setTheme`. Inlined from the web ThemeProvider. */
export type ThemeId =
  | 'neon-cyan'
  | 'tesla-red'
  | 'matrix-green'
  | 'royal-purple'
  | 'solar-amber'
  | 'custom';

/* ------------------------------------------------------------------ */
/*  Native-safe i18n shim                                              */
/* ------------------------------------------------------------------ */

/** Options accepted by the native translate shim. Mirrors the i18next options
 * the registry passes (`defaultValue` plus `{{var}}` interpolation values). */
export interface CommandTranslateOptions {
  defaultValue?: string;
  [key: string]: unknown;
}

/**
 * Native-safe replacement for react-i18next's `TFunction`. Supports the two
 * call shapes the registry uses: `t(key, fallback)` and
 * `t(key, { defaultValue, ...vars })`. Exported so callers can type a real `t`.
 */
export type CommandTranslate = (
  key: string,
  defaultValueOrOptions?: string | CommandTranslateOptions,
  options?: CommandTranslateOptions,
) => string;

/** Fallback translate: resolves the English copy and `{{var}}` interpolation
 * without an i18n provider (translationProviderAvailable: false). */
const defaultTranslate: CommandTranslate = (
  key,
  defaultValueOrOptions,
  options,
) => {
  let fallback = key;
  let opts: CommandTranslateOptions | undefined;
  if (typeof defaultValueOrOptions === 'string') {
    fallback = defaultValueOrOptions;
    opts = options;
  } else if (defaultValueOrOptions) {
    opts = defaultValueOrOptions;
    fallback =
      typeof defaultValueOrOptions.defaultValue === 'string'
        ? defaultValueOrOptions.defaultValue
        : key;
  }
  if (!opts) return fallback;
  const resolved = opts;
  return fallback.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(resolved, name)
      ? String(resolved[name])
      : match,
  );
};

/* ------------------------------------------------------------------ */
/*  Native-safe toast facade                                          */
/* ------------------------------------------------------------------ */

/** Toast surface the registry's `perform()` handlers call. Native-safe shape of
 * the web `useToast()` return value. */
export interface CommandToast {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

/** Default toast: React Native `Alert.alert` for all three levels (the
 * `_toastHelpers` precedent; toastQueueAvailable: false). */
const defaultToast: CommandToast = {
  success: message => Alert.alert(message),
  error: message => Alert.alert(message),
  info: message => Alert.alert(message),
};

/* ------------------------------------------------------------------ */
/*  Native-safe window / document / storage facades                   */
/* ------------------------------------------------------------------ */
// The web `perform()` handlers fire `window.dispatchEvent(new CustomEvent(name))`
// app-event-bus signals, read the dark class off `document.documentElement`, and
// wipe a localStorage frecency key. They are reached through `globalThis` so the
// real browser implementations satisfy them on the react-native-web target while
// a pure native runtime simply has no such surface and the call no-ops.

interface AppEventLike {
  readonly type: string;
}

type AppEventConstructor = new (type: string) => AppEventLike;

interface AppEventTargetLike {
  dispatchEvent?(event: AppEventLike): void;
}

function getWindowEventTarget(): AppEventTargetLike | undefined {
  const candidate = (
    globalThis as typeof globalThis & {window?: AppEventTargetLike}
  ).window;
  return candidate && typeof candidate.dispatchEvent === 'function'
    ? candidate
    : undefined;
}

function getCustomEventConstructor(): AppEventConstructor | undefined {
  const candidate = (
    globalThis as typeof globalThis & {CustomEvent?: AppEventConstructor}
  ).CustomEvent;
  return typeof candidate === 'function' ? candidate : undefined;
}

/** Dispatches `new CustomEvent(name)` on the window facade exactly as the web
 * handlers do, when both `dispatchEvent` and a `CustomEvent` constructor exist
 * (react-native-web target). No-op otherwise (windowEventBusAvailable: false). */
function dispatchAppEvent(name: string): void {
  const target = getWindowEventTarget();
  const EventCtor = getCustomEventConstructor();
  if (target?.dispatchEvent && EventCtor) {
    target.dispatchEvent(new EventCtor(name));
  }
}

/** Navigate-then-dispatch-on-next-tick helper. Mirrors the web
 * `window.setTimeout(() => window.dispatchEvent(...), 50)` so the destination
 * page's listener is mounted before the event fires. */
function scheduleAppEvent(name: string, delayMs: number): void {
  setTimeout(() => dispatchAppEvent(name), delayMs);
}

interface DocumentLike {
  documentElement?: {classList?: {contains(token: string): boolean}};
}

/** Reads the `dark` class the web ThemeProvider sets on `<html>`. Preserved on
 * the react-native-web target via the document facade; defaults to `true` (the
 * app's default mode) on a pure native runtime with no DOM. */
function isDarkMode(): boolean {
  const doc = (globalThis as typeof globalThis & {document?: DocumentLike})
    .document;
  const classList = doc?.documentElement?.classList;
  if (classList && typeof classList.contains === 'function') {
    return classList.contains('dark');
  }
  return true;
}

const FRECENCY_STORAGE_KEY = 'teslasync:cmd-frecency:v1';

interface WebStorageLike {
  removeItem(key: string): void;
}

/** Native projection of web `_resetFrecency()`: removes the same
 * `teslasync:cmd-frecency:v1` localStorage key through the `globalThis` storage
 * facade (react-native-web), failing silently otherwise — matching the web
 * try/catch (frecencyStorageAvailable: false off-web). */
function resetFrecencyStorage(): void {
  try {
    const storage = (
      globalThis as typeof globalThis & {localStorage?: WebStorageLike}
    ).localStorage;
    storage?.removeItem(FRECENCY_STORAGE_KEY);
  } catch {
    /* ignore — same rationale as the web save() / _resetFrecency() */
  }
}

/** Explicit capability matrix for the native command-registry surface. All
 * false on a pure native runtime (no react-router, no ThemeProvider, no
 * selected-vehicle store, no i18n provider, no toast queue, no window event bus,
 * no localStorage); the window/document/storage paths still run on the
 * react-native-web target where the real browser surfaces are present. */
export const nativeCommandRegistryCapabilities = {
  reactRouterNavigateAvailable: false,
  themeProviderAvailable: false,
  selectedVehicleStoreAvailable: false,
  translationProviderAvailable: false,
  toastQueueAvailable: false,
  windowEventBusAvailable: false,
  frecencyStorageAvailable: false,
} as const;

/* ------------------------------------------------------------------ */
/*  Inlined commandRegistry types (web @/lib/commandRegistry)          */
/* ------------------------------------------------------------------ */

export type CommandSection = 'actions' | 'preferences' | 'pages' | 'vehicles';

/** The exact global event the web tour registry dispatches to open the tour
 * launcher; preserved byte-for-byte (web `@/lib/tourRegistry`). */
const TOUR_OPEN_LAUNCHER_EVENT = 'teslasync:tour:openLauncher';

/**
 * Native-safe icon identifier. The web registry references Lucide *components*
 * (`Icons.moon`, …); those are browser-only, so each is projected to its stable
 * alias name here. A native CommandPalette maps the name to a native glyph.
 */
export type CommandIcon =
  | 'moon'
  | 'sun'
  | 'sunMoon'
  | 'palette'
  | 'refresh'
  | 'notifications'
  | 'notificationsActive'
  | 'workflow'
  | 'locked'
  | 'speed'
  | 'history'
  | 'terminal'
  | 'download'
  | 'settings'
  | 'keyboard'
  | 'bug'
  | 'helpCircle'
  | 'edit'
  | 'layoutDashboard'
  | 'add'
  | 'undo';

export interface CommandContext {
  /** Native-safe replacement for react-router's `NavigateFunction` (the registry
   * only ever calls `navigate('/path')`). */
  navigate: (path: string) => void;
  setMode: (id: ModeId) => void;
  setTheme: (id: ThemeId) => void;
  setVehicleId: (id: number | null) => void;
  invalidateAll: () => Promise<void>;
  /** Translate fn — `perform()` should use this for any user-facing string. */
  t: CommandTranslate;
  toast: CommandToast;
}

export interface CommandDefinition {
  /** Stable identifier — used as React key, recent-storage key, and test selector */
  id: string;
  /** i18n key looked up by the hook */
  labelKey: string;
  /** English fallback shown when the i18n key is missing */
  labelFallback: string;
  /** Stable icon-name (native projection of the web Lucide icon component) */
  icon: CommandIcon;
  /** Section header the entry appears under */
  section: CommandSection;
  /** Extra search keywords for fuzzy matching */
  keywords?: string[];
  /** Optional keyboard shortcut hint (display-only, e.g. "T", "?") */
  shortcut?: string;
  /** Imperative side effect — invoked when the user picks the entry */
  perform: (ctx: CommandContext) => void | Promise<void>;
}

/**
 * Default commands available app-wide. Faithful native projection of the web
 * `commandRegistry` (web/src/lib/commandRegistry.ts) — every id / labelKey /
 * labelFallback / section / keywords / shortcut preserved; icons projected to
 * stable names; browser-only `perform()` side effects routed through the
 * native-safe facades above.
 */
export const commandRegistry: CommandDefinition[] = [
  // ── Preferences ───────────────────────────────────────────────────────────
  {
    id: 'pref.theme.dark',
    labelKey: 'palette.cmd.themeDark',
    labelFallback: 'Theme: Dark',
    icon: 'moon',
    section: 'preferences',
    keywords: ['theme', 'dark', 'mode', 'night'],
    perform: ctx => ctx.setMode('dark'),
  },
  {
    id: 'pref.theme.light',
    labelKey: 'palette.cmd.themeLight',
    labelFallback: 'Theme: Light',
    icon: 'sun',
    section: 'preferences',
    keywords: ['theme', 'light', 'mode', 'day', 'bright'],
    perform: ctx => ctx.setMode('light'),
  },
  {
    id: 'pref.theme.oled',
    labelKey: 'palette.cmd.themeOled',
    labelFallback: 'Theme: OLED Black',
    icon: 'moon',
    section: 'preferences',
    keywords: ['theme', 'oled', 'black', 'mode', 'amoled'],
    perform: ctx => ctx.setMode('oled'),
  },
  {
    id: 'pref.theme.midnight',
    labelKey: 'palette.cmd.themeMidnight',
    labelFallback: 'Theme: Midnight Blue',
    icon: 'moon',
    section: 'preferences',
    keywords: ['theme', 'midnight', 'blue', 'mode'],
    perform: ctx => ctx.setMode('midnight'),
  },
  {
    id: 'pref.theme.auto',
    labelKey: 'palette.cmd.themeAuto',
    labelFallback: 'Theme: Auto (system)',
    icon: 'sunMoon',
    section: 'preferences',
    keywords: ['theme', 'auto', 'system', 'mode'],
    perform: ctx => ctx.setMode('auto'),
  },
  {
    id: 'pref.themePicker',
    labelKey: 'palette.cmd.themePicker',
    labelFallback: 'Open theme picker',
    icon: 'palette',
    section: 'preferences',
    keywords: [
      'theme',
      'color',
      'picker',
      'preferences',
      'appearance',
      'customize',
    ],
    shortcut: 'T',
    perform: () => {
      // The shell listens for this event to open the top-bar theme popover (no
      // navigation away from the current page).
      dispatchAppEvent('open-theme-popover');
    },
  },

  // ── Per-theme switch commands ──────────────────────
  // Surfacing every named theme so power users can `Cmd+K → tesla red → ↵`.
  {
    id: 'pref.theme.neonCyan',
    labelKey: 'palette.cmd.themeNeonCyan',
    labelFallback: 'Switch to Neon Cyan',
    icon: 'palette',
    section: 'preferences',
    keywords: ['theme', 'switch', 'neon', 'cyan', 'color'],
    perform: ctx => {
      ctx.setTheme('neon-cyan');
      ctx.toast.info(
        ctx.t('theme.switchedTo', {
          name: 'Neon Cyan',
          defaultValue: 'Switched to Neon Cyan',
        }),
      );
    },
  },
  {
    id: 'pref.theme.teslaRed',
    labelKey: 'palette.cmd.themeTeslaRed',
    labelFallback: 'Switch to Tesla Red',
    icon: 'palette',
    section: 'preferences',
    keywords: ['theme', 'switch', 'tesla', 'red', 'color'],
    perform: ctx => {
      ctx.setTheme('tesla-red');
      ctx.toast.info(
        ctx.t('theme.switchedTo', {
          name: 'Tesla Red',
          defaultValue: 'Switched to Tesla Red',
        }),
      );
    },
  },
  {
    id: 'pref.theme.matrixGreen',
    labelKey: 'palette.cmd.themeMatrixGreen',
    labelFallback: 'Switch to Matrix Green',
    icon: 'palette',
    section: 'preferences',
    keywords: ['theme', 'switch', 'matrix', 'green', 'color'],
    perform: ctx => {
      ctx.setTheme('matrix-green');
      ctx.toast.info(
        ctx.t('theme.switchedTo', {
          name: 'Matrix Green',
          defaultValue: 'Switched to Matrix Green',
        }),
      );
    },
  },
  {
    id: 'pref.theme.royalPurple',
    labelKey: 'palette.cmd.themeRoyalPurple',
    labelFallback: 'Switch to Royal Purple',
    icon: 'palette',
    section: 'preferences',
    keywords: ['theme', 'switch', 'royal', 'purple', 'color'],
    perform: ctx => {
      ctx.setTheme('royal-purple');
      ctx.toast.info(
        ctx.t('theme.switchedTo', {
          name: 'Royal Purple',
          defaultValue: 'Switched to Royal Purple',
        }),
      );
    },
  },
  {
    id: 'pref.theme.solarAmber',
    labelKey: 'palette.cmd.themeSolarAmber',
    labelFallback: 'Switch to Solar Amber',
    icon: 'palette',
    section: 'preferences',
    keywords: ['theme', 'switch', 'solar', 'amber', 'color'],
    perform: ctx => {
      ctx.setTheme('solar-amber');
      ctx.toast.info(
        ctx.t('theme.switchedTo', {
          name: 'Solar Amber',
          defaultValue: 'Switched to Solar Amber',
        }),
      );
    },
  },
  {
    id: 'pref.theme.toggleMode',
    labelKey: 'palette.cmd.themeToggleMode',
    labelFallback: 'Toggle dark mode',
    icon: 'sunMoon',
    section: 'preferences',
    keywords: ['theme', 'toggle', 'dark', 'light', 'mode', 'switch'],
    perform: ctx => {
      // Read the current mode from the `dark` class the web ThemeProvider sets
      // on <html> (isDarkMode()'s document facade preserves this on
      // react-native-web; defaults to dark off-DOM). This avoids threading the
      // current mode through CommandContext for every command.
      const isDark = isDarkMode();
      ctx.setMode(isDark ? 'light' : 'dark');
      ctx.toast.info(
        ctx.t(
          isDark ? 'theme.switchedToLight' : 'theme.switchedToDark',
          isDark ? 'Switched to light mode' : 'Switched to dark mode',
        ),
      );
    },
  },

  // ── Actions ───────────────────────────────────────────────────────────────
  {
    id: 'action.refresh',
    labelKey: 'palette.cmd.refresh',
    labelFallback: 'Refresh data',
    icon: 'refresh',
    section: 'actions',
    keywords: ['refresh', 'reload', 'update', 'invalidate', 'sync'],
    perform: async ctx => {
      await ctx.invalidateAll();
      ctx.toast.success(ctx.t('palette.toast.refreshed', 'Data refreshed'));
    },
  },
  {
    id: 'action.alerts.new',
    labelKey: 'palette.cmd.newAlert',
    labelFallback: 'Create new alert rule',
    icon: 'notifications',
    section: 'actions',
    keywords: ['alert', 'rule', 'new', 'create', 'notification', 'notify'],
    perform: ctx => ctx.navigate('/notifications/studio'),
  },
  {
    id: 'action.alerts.test',
    labelKey: 'palette.cmd.testAlert',
    labelFallback: 'Send a test alert',
    icon: 'notificationsActive',
    section: 'actions',
    keywords: ['alert', 'test', 'notification', 'check', 'verify'],
    perform: ctx => ctx.navigate('/alert-studio?test=1'),
  },
  {
    id: 'action.notifications.history',
    labelKey: 'palette.cmd.notificationsHistory',
    labelFallback: 'Open notification history',
    icon: 'notificationsActive',
    section: 'actions',
    keywords: ['notifications', 'history', 'log', 'past'],
    perform: ctx => ctx.navigate('/notifications/inbox'),
  },
  {
    id: 'action.commands.history',
    labelKey: 'palette.cmd.commandHistory',
    labelFallback: 'Open command history',
    icon: 'workflow',
    section: 'actions',
    keywords: ['command', 'history', 'log', 'past', 'audit'],
    perform: ctx => ctx.navigate('/command-history'),
  },
  {
    id: 'action.security',
    labelKey: 'palette.cmd.securitySettings',
    labelFallback: 'Open security & access',
    icon: 'locked',
    section: 'actions',
    keywords: ['security', 'access', 'lock', 'safety', 'guard'],
    perform: ctx => ctx.navigate('/security-access'),
  },
  {
    id: 'action.system.status',
    labelKey: 'palette.cmd.systemStatus',
    labelFallback: 'View system status',
    icon: 'speed',
    section: 'actions',
    keywords: ['system', 'status', 'health', 'uptime', 'service'],
    perform: ctx => ctx.navigate('/system-status'),
  },
  {
    // Open the global time-machine date picker. The banner (rendered in the
    // shell) listens for the 'time-machine.open-picker' event and reveals an
    // inline date input. The command is one-click — choosing a date is a
    // separate, deliberate step inside the banner.
    id: 'time-machine.open',
    labelKey: 'palette.cmd.timeMachineOpen',
    labelFallback: 'Open time machine',
    icon: 'history',
    section: 'actions',
    keywords: [
      'time',
      'machine',
      'history',
      'as of',
      'point-in-time',
      'replay',
      'past',
    ],
    perform: () => {
      dispatchAppEvent('time-machine.open-picker');
    },
  },
  {
    id: 'action.api.playground',
    labelKey: 'palette.cmd.apiPlayground',
    labelFallback: 'Open API playground',
    icon: 'terminal',
    section: 'actions',
    keywords: ['api', 'playground', 'rest', 'developer', 'test'],
    perform: ctx => ctx.navigate('/api-playground'),
  },
  {
    id: 'action.export',
    labelKey: 'palette.cmd.export',
    labelFallback: 'Open data export',
    icon: 'download',
    section: 'actions',
    keywords: ['export', 'csv', 'download', 'data', 'backup'],
    perform: ctx => ctx.navigate('/data-export'),
  },
  {
    id: 'action.settings',
    labelKey: 'palette.cmd.settings',
    labelFallback: 'Open settings',
    icon: 'settings',
    section: 'actions',
    keywords: ['settings', 'preferences', 'options', 'config'],
    perform: ctx => ctx.navigate('/settings'),
  },
  {
    id: 'action.shortcuts',
    labelKey: 'palette.cmd.shortcuts',
    labelFallback: 'Show keyboard shortcuts',
    icon: 'keyboard',
    section: 'actions',
    keywords: ['keyboard', 'shortcuts', 'keys', 'help', 'cheatsheet'],
    shortcut: '?',
    perform: () => {
      dispatchAppEvent('toggle-keyboard-shortcuts');
    },
  },
  {
    // Opens the in-app feedback modal. The command id MUST stay literally
    // "feedback.open"; the web audit gate scans for that exact string.
    id: 'feedback.open',
    labelKey: 'palette.cmd.feedback',
    labelFallback: 'Report bug / Send feedback',
    icon: 'bug',
    section: 'actions',
    keywords: [
      'feedback',
      'bug',
      'report',
      'issue',
      'problem',
      'suggestion',
      'feature request',
      'send',
    ],
    perform: () => {
      dispatchAppEvent('open-feedback-modal');
    },
  },
  {
    id: 'action.tour',
    labelKey: 'palette.cmd.tour',
    labelFallback: 'Show tours',
    icon: 'helpCircle',
    section: 'actions',
    keywords: [
      'tour',
      'tours',
      'walkthrough',
      'onboarding',
      'guide',
      'help',
      'tutorial',
    ],
    perform: () => {
      dispatchAppEvent(TOUR_OPEN_LAUNCHER_EVENT);
    },
  },
  {
    id: 'action.changelog.openModal',
    labelKey: 'palette.cmd.changelog',
    labelFallback: "What's new",
    icon: 'helpCircle',
    section: 'actions',
    keywords: [
      'changelog',
      'release',
      'notes',
      'whats',
      'new',
      'updates',
      'features',
    ],
    perform: () => {
      dispatchAppEvent('teslasync:changelog:open');
    },
  },

  // ── Dashboard customization ────────────────────────
  // The dashboard listens for these events (`dashboard:*`). The palette
  // navigates to /dashboard first so the listener is mounted, then dispatches
  // on the next tick.
  {
    id: 'action.dashboard.edit',
    labelKey: 'palette.cmd.dashboardEdit',
    labelFallback: 'Edit dashboard layout',
    icon: 'edit',
    section: 'actions',
    keywords: ['dashboard', 'edit', 'customize', 'rearrange', 'layout', 'widgets'],
    shortcut: 'E',
    perform: ctx => {
      ctx.navigate('/dashboard');
      scheduleAppEvent('dashboard:toggle-edit', 50);
    },
  },
  {
    id: 'action.dashboard.switch',
    labelKey: 'palette.cmd.dashboardSwitch',
    labelFallback: 'Switch dashboard layout…',
    icon: 'layoutDashboard',
    section: 'actions',
    keywords: ['dashboard', 'switch', 'layout', 'preset', 'change'],
    perform: ctx => {
      ctx.navigate('/dashboard');
      scheduleAppEvent('dashboard:open-switcher', 50);
    },
  },
  {
    id: 'action.dashboard.addWidget',
    labelKey: 'palette.cmd.dashboardAddWidget',
    labelFallback: 'Add widget to dashboard',
    icon: 'add',
    section: 'actions',
    keywords: ['dashboard', 'widget', 'add', 'panel', 'insert'],
    perform: ctx => {
      ctx.navigate('/dashboard');
      scheduleAppEvent('dashboard:add-widget', 50);
    },
  },
  {
    id: 'action.dashboard.reset',
    labelKey: 'palette.cmd.dashboardReset',
    labelFallback: 'Reset dashboard to default',
    icon: 'undo',
    section: 'actions',
    keywords: ['dashboard', 'reset', 'default', 'clear', 'restore'],
    perform: ctx => {
      ctx.navigate('/dashboard');
      scheduleAppEvent('dashboard:reset', 50);
    },
  },

  // ── Privacy / housekeeping ─────────────────────────
  // Lets users on shared devices clear the per-command usage counts that drive
  // the palette's "Most Used" section. Pure local action — no server round-trip.
  {
    id: 'action.frecency.reset',
    labelKey: 'palette.cmd.frecencyReset',
    labelFallback: 'Reset command palette usage history',
    icon: 'undo',
    section: 'actions',
    keywords: [
      'reset',
      'clear',
      'frecency',
      'usage',
      'history',
      'palette',
      'privacy',
      'most used',
    ],
    perform: ctx => {
      resetFrecencyStorage();
      ctx.toast.success(
        ctx.t(
          'palette.toast.frecencyReset',
          'Command palette usage history cleared',
        ),
      );
    },
  },
];

/**
 * Lower-case substring + first-letter score. Bigger is better; 0 means no match.
 * Ported verbatim from web `scoreCommand` (pure JS — runs identically under
 * Hermes). Keeps the palette responsive without a fuzzy lib.
 *
 * Heuristics (in priority order):
 *   1. Exact label match → 1000
 *   2. Label starts with query → 500 + length bonus
 *   3. Label contains query as substring → 200 + length bonus
 *   4. Acronym match (first letters of words) → 150
 *   5. Keyword starts-with → 100
 *   6. Keyword substring → 50
 *   7. All query letters appear in order in label → 25
 */
export function scoreCommand(
  query: string,
  label: string,
  keywords: string[] = [],
): number {
  if (!query) return 1;
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const labelLower = label.toLowerCase();

  if (labelLower === q) return 1000;
  if (labelLower.startsWith(q)) return 500 + q.length;
  if (labelLower.includes(q)) return 200 + q.length;

  // Acronym (first letters of each word)
  const acronym = labelLower
    .split(/[\s\-_/:.]+/)
    .map(w => w[0] ?? '')
    .join('');
  if (acronym.includes(q)) return 150;

  for (const kw of keywords) {
    const k = kw.toLowerCase();
    if (k.startsWith(q)) return 100;
    if (k.includes(q)) return 50;
  }

  // Subsequence: every char of q appears in label in order ("btr" → "Battery").
  let i = 0;
  for (const ch of labelLower) {
    if (ch === q[i]) i++;
    if (i === q.length) return 25;
  }

  return 0;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * Resolved palette command — what a CommandPalette consumes after the registry
 * is wired to live React context.
 */
export interface ResolvedCommand {
  id: string;
  label: string;
  section: CommandSection | string;
  icon: CommandDefinition['icon'];
  keywords: string[];
  shortcut?: string;
  /** Tag commands that originate from the static registry — used for recent storage */
  source: 'registry' | 'extension';
  invoke: () => void | Promise<void>;
}

/**
 * Native-safe handles injected into the resolved {@link CommandContext}. All are
 * optional so `useCommandRegistry()` stays callable with zero arguments (the web
 * call site); a screen can lift navigation / theme / vehicle / toast / i18n into
 * its own navigator + providers. Omitted handles fall back to the native-safe
 * defaults (no-op navigation/theme/vehicle, `Alert.alert` toast, fallback `t`).
 */
export interface UseCommandRegistryOptions {
  onNavigate?: (path: string) => void;
  setMode?: (id: ModeId) => void;
  setTheme?: (id: ThemeId) => void;
  setVehicleId?: (id: number | null) => void;
  toast?: CommandToast;
  t?: CommandTranslate;
}

export interface UseCommandRegistryResult {
  commands: ResolvedCommand[];
  getById: (id: string) => ResolvedCommand | undefined;
  filter: (query: string) => ResolvedCommand[];
}

/** Inert default handle for the browser-only effects we cannot perform natively. */
function noop(): void {}

/**
 * useCommandRegistry.
 *
 * Resolves the inlined {@link commandRegistry} against live React handles
 * (navigate, theme, toast, queryClient) and returns:
 *   - `commands`: ready-to-render palette items (filterable / sortable)
 *   - `getById(id)`: lookup by stable id (used to replay recent commands)
 *   - `filter(query)`: fuzzy-filter & sort by relevance score
 *
 * `useQueryClient()` is the only live provider dependency on native; the rest are
 * supplied via `options` (or fall back to native-safe defaults).
 */
export function useCommandRegistry(
  options: UseCommandRegistryOptions = {},
): UseCommandRegistryResult {
  const {
    onNavigate = noop,
    setMode = noop,
    setTheme = noop,
    setVehicleId = noop,
    toast = defaultToast,
    t = defaultTranslate,
  } = options;
  const queryClient = useQueryClient();

  const ctx = useMemo<CommandContext>(
    () => ({
      navigate: onNavigate,
      setMode,
      setTheme,
      setVehicleId,
      invalidateAll: async () => {
        await queryClient.invalidateQueries();
      },
      t,
      toast: {
        success: (msg: string) => toast.success(msg),
        error: (msg: string) => toast.error(msg),
        info: (msg: string) => toast.info(msg),
      },
    }),
    [onNavigate, setMode, setTheme, setVehicleId, queryClient, toast, t],
  );

  const commands = useMemo<ResolvedCommand[]>(
    () =>
      commandRegistry.map(def => ({
        id: def.id,
        label: t(def.labelKey, def.labelFallback),
        section: def.section,
        icon: def.icon,
        keywords: def.keywords ?? [],
        shortcut: def.shortcut,
        source: 'registry' as const,
        invoke: () => def.perform(ctx),
      })),
    [ctx, t],
  );

  const getById = useCallback(
    (id: string): ResolvedCommand | undefined =>
      commands.find(c => c.id === id),
    [commands],
  );

  const filter = useCallback(
    (query: string): ResolvedCommand[] => {
      if (!query.trim()) return commands;
      const scored = commands
        .map(c => ({c, score: scoreCommand(query, c.label, c.keywords)}))
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score);
      return scored.map(s => s.c);
    },
    [commands],
  );

  return {commands, getById, filter};
}
