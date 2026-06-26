// Native parity port of web/src/lib/commandRegistry.ts.
//
// Web parity source: web/src/lib/commandRegistry.ts.
//
// The web module is the command-palette command registry: a static,
// declarative `CommandDefinition[]` of "global" palette commands plus the
// `scoreCommand()` fuzzy ranker. It is intentionally pure data so it can be
// unit-tested and audited independently of the palette UI; the `perform()`
// side effects are wired to live navigation/theme/toast/query handles via a
// `CommandContext` the (web) `useCommandRegistry` hook supplies.
//
// This native port preserves the registry data and scoring logic 1:1 — the
// same command ids (including the audit-pinned literal `feedback.open`),
// i18n keys + fallbacks, sections, keywords, shortcuts, navigation paths, and
// the same `scoreCommand` heuristics — using React Native-safe substitutions
// for the browser/web-only seams, each documented in the .parity.json sidecar:
//   - `react-router-dom` `NavigateFunction` (web L1): React Native has no DOM
//     router. Every `ctx.navigate('/path')` call passes a single string path,
//     so `NavigateFunction` is narrowed to a native-safe `(path: string) =>
//     void` bridge the native host wires to its own navigator.
//   - `i18next` `TFunction` (web L2): i18next is not a native dependency, so
//     `t` is typed as a native-safe `CommandTFunction` projection that accepts
//     the exact two call shapes the registry uses — `t(key, defaultValue)` and
//     `t(key, { defaultValue, ...interpolation })` — and returns a string.
//   - `ModeId` / `ThemeId` from `@/components/ui/ThemeProvider` (web L3): the
//     theme/mode id unions are inlined verbatim (no native ThemeProvider yet).
//   - `Icons` / `LucideIcon` from `@/lib/icons` (web L4, L8): lucide DOM SVG
//     components are unavailable in React Native. Every icon used here has a
//     1:1 match in the native `SemanticIconName` registry, so `icon` is typed
//     as `SemanticIconName` (re-exported as `LucideIcon` to preserve the web
//     export surface), and a native-safe `Icons` concept→`SemanticIconName`
//     shim lets each entry keep its `icon: Icons.x` reference verbatim.
//   - `TOUR_OPEN_LAUNCHER_EVENT` from `@/lib/tourRegistry` (web L5): inlined
//     verbatim as the canonical event name (matches the existing native
//     HelpSegment port constant).
//   - `_resetFrecency` from `@/lib/commandFrecency` (web L6): the web wipes the
//     `localStorage` frecency store. The native-safe inline below feature-
//     detects `globalThis.localStorage` (present on react-native-web) and
//     clears the same `teslasync:cmd-frecency:v1` key; on pure React Native
//     (no localStorage) it is an explicit, documented no-op until the separate
//     commandFrecency module is ported (contract rule 7).
//   - browser-only `perform()` seams: `window.dispatchEvent(new CustomEvent(
//     name))` becomes `emitCommandEvent(name)` on a module-level event bus
//     (the native analog of the single global `window` bus — preserving every
//     event-name string verbatim so native host listeners keep the same
//     contract), `window.setTimeout` becomes the global `setTimeout`, and
//     `document.documentElement.classList.contains('dark')` becomes the
//     host-supplied `CommandContext.isDarkMode` flag (React Native has no DOM
//     to read the active mode from).

import type { SemanticIconName } from '../../components/icons/SemanticIcon';

/**
 * Native alias preserving the web `export type { LucideIcon }` surface (web
 * L4/L8). On native an icon is identified by its `SemanticIconName`, which the
 * UI renders through `<SemanticIcon name={icon} />`.
 */
export type LucideIcon = SemanticIconName;
export type { SemanticIconName };

/* ------------------------------------------------------------------ */
/*  Native-safe projections of the web `@/*` type imports              */
/* ------------------------------------------------------------------ */

/**
 * Native-safe projection of react-router-dom's `NavigateFunction` (web L1).
 * Every registry command calls `ctx.navigate('/path')` with a single string
 * path, so the native host bridges this to its own navigator.
 */
export type NavigateFunction = (path: string) => void;

/** Theme id union, inlined verbatim from `@/components/ui/ThemeProvider` (web L3). */
export type ThemeId =
  | 'neon-cyan'
  | 'tesla-red'
  | 'matrix-green'
  | 'royal-purple'
  | 'solar-amber'
  | 'custom';

/** Mode id union, inlined verbatim from `@/components/ui/ThemeProvider` (web L3). */
export type ModeId =
  | 'dark'
  | 'light'
  | 'oled'
  | 'midnight'
  | 'auto'
  | 'sunset'
  | 'nord';

/** Options bag for the native `t` projection: i18next-style default + interpolation. */
export interface CommandTranslateOptions {
  /** English fallback used when the i18n key is missing. */
  defaultValue?: string;
  /** Interpolation values (e.g. `{ name: 'Neon Cyan' }`). */
  [key: string]: unknown;
}

/**
 * Native-safe projection of i18next's `TFunction` (web L2). Supports the two
 * call shapes this registry uses — `t(key, defaultValue)` and
 * `t(key, { defaultValue, ...interpolation })` — and always returns a string.
 */
export interface CommandTFunction {
  (key: string, defaultValue?: string): string;
  (key: string, options: CommandTranslateOptions): string;
}

/* ------------------------------------------------------------------ */
/*  Native-safe `Icons` shim (web `@/lib/icons`, L4)                    */
/* ------------------------------------------------------------------ */

/**
 * Concept→`SemanticIconName` shim mirroring the subset of the web `Icons`
 * registry this module references, so every entry keeps its `icon: Icons.x`
 * form verbatim. Each value is rendered natively via `<SemanticIcon />`.
 */
const Icons = {
  moon: 'moon',
  sun: 'sun',
  sunMoon: 'sunMoon',
  palette: 'palette',
  refresh: 'refresh',
  notifications: 'notifications',
  notificationsActive: 'notificationsActive',
  workflow: 'workflow',
  locked: 'locked',
  speed: 'speed',
  history: 'history',
  terminal: 'terminal',
  download: 'download',
  settings: 'settings',
  keyboard: 'keyboard',
  bug: 'bug',
  helpCircle: 'helpCircle',
  edit: 'edit',
  layoutDashboard: 'layoutDashboard',
  add: 'add',
  undo: 'undo',
} satisfies Record<string, SemanticIconName>;

/* ------------------------------------------------------------------ */
/*  Command-event bus (native analog of the web `window` CustomEvents) */
/* ------------------------------------------------------------------ */

/**
 * Event names dispatched by command `perform()` side effects. Preserved
 * verbatim from the web `window.dispatchEvent(new CustomEvent(name))` strings
 * so native host listeners (the analogs of the web `window.addEventListener`
 * consumers in Layout / DashboardPage / ChangelogModal / TimeMachineBanner)
 * keep the same decoupled contract.
 */
export const COMMAND_EVENT = {
  openThemePopover: 'open-theme-popover',
  timeMachineOpenPicker: 'time-machine.open-picker',
  toggleKeyboardShortcuts: 'toggle-keyboard-shortcuts',
  openFeedbackModal: 'open-feedback-modal',
  openTourLauncher: 'teslasync:tour:openLauncher',
  openChangelog: 'teslasync:changelog:open',
  dashboardToggleEdit: 'dashboard:toggle-edit',
  dashboardOpenSwitcher: 'dashboard:open-switcher',
  dashboardAddWidget: 'dashboard:add-widget',
  dashboardReset: 'dashboard:reset',
} as const;

export type CommandEventName =
  (typeof COMMAND_EVENT)[keyof typeof COMMAND_EVENT];

/**
 * Canonical tour-launcher event name, inlined from `@/lib/tourRegistry` (web
 * L5) and kept as a named export for host wiring, matching the existing native
 * HelpSegment port constant.
 */
export const TOUR_OPEN_LAUNCHER_EVENT = COMMAND_EVENT.openTourLauncher;

type CommandEventListener = () => void;
const commandEventListeners = new Map<
  CommandEventName,
  Set<CommandEventListener>
>();

/**
 * Native analog of `window.dispatchEvent(new CustomEvent(name))`. Notifies
 * every listener subscribed to `name`; missing/throwing listeners never break
 * the dispatch.
 */
export function emitCommandEvent(name: CommandEventName): void {
  const set = commandEventListeners.get(name);
  if (!set) {
    return;
  }
  // Snapshot — a listener may add/remove during dispatch.
  for (const listener of [...set]) {
    try {
      listener();
    } catch {
      // A faulty host listener must not break the palette command channel.
    }
  }
}

/**
 * Native analog of `window.addEventListener(name, listener)`. Returns an
 * unsubscribe function (the analog of `removeEventListener`).
 */
export function subscribeCommandEvent(
  name: CommandEventName,
  listener: CommandEventListener,
): () => void {
  let set = commandEventListeners.get(name);
  if (!set) {
    set = new Set();
    commandEventListeners.set(name, set);
  }
  set.add(listener);
  return () => {
    commandEventListeners.get(name)?.delete(listener);
  };
}

/** Test-only helper: drop every registered command-event listener. */
export function __resetCommandEventsForTests(): void {
  commandEventListeners.clear();
}

/* ------------------------------------------------------------------ */
/*  Native-safe `_resetFrecency` inline (web `@/lib/commandFrecency`)   */
/* ------------------------------------------------------------------ */

/** localStorage key the web frecency store uses; preserved for parity. */
const FRECENCY_STORAGE_KEY = 'teslasync:cmd-frecency:v1';

interface LocalStorageLike {
  removeItem(key: string): void;
}

/**
 * Native-safe inline of `@/lib/commandFrecency`'s `_resetFrecency` (web L6).
 * Wipes all stored palette usage counts. Feature-detects `globalThis.
 * localStorage` (present on react-native-web) and removes the same key the web
 * uses; on pure React Native there is no `localStorage`, so this is an
 * explicit no-op until the separate commandFrecency module is ported.
 */
function _resetFrecency(): void {
  try {
    const candidate = (
      globalThis as typeof globalThis & { localStorage?: LocalStorageLike }
    ).localStorage;
    if (candidate && typeof candidate.removeItem === 'function') {
      candidate.removeItem(FRECENCY_STORAGE_KEY);
    }
  } catch {
    // Quota / disabled storage — fail silently, same rationale as the web save().
  }
}

/**
 * Command registry.
 *
 * Static, declarative list of "global" palette commands. The list is intentionally
 * decoupled from React/hooks — it's pure data so it can be unit-tested and
 * audited independently of the palette UI. The {@link useCommandRegistry} hook
 * wires each entry to live navigation/theme/toast/queryClient handles via the
 * {@link CommandContext}.
 *
 * Per the prompt's design constraints:
 *   - Every command is one click — no multi-step flows
 *   - Vehicle commands stay in CommandPalette's PALETTE_COMMAND_CONFIGS
 *     (those need vehicle-selection branching that doesn't fit one click)
 *   - Vehicle SWITCHING (the persistent picker) is generated dynamically
 *     in the hook from the live vehicle list
 */

export type CommandSection = 'actions' | 'preferences' | 'pages' | 'vehicles';

export interface CommandContext {
  navigate: NavigateFunction;
  setMode: (id: ModeId) => void;
  setTheme: (id: ThemeId) => void;
  /**
   * Native replacement for the web `document.documentElement.classList.
   * contains('dark')` read. The host supplies the live resolved dark-mode
   * flag (React Native has no DOM), so the toggle-mode command can flip it.
   */
  isDarkMode: boolean;
  setVehicleId: (id: number | null) => void;
  invalidateAll: () => Promise<void>;
  /** i18next translate fn — perform() should use this for any user-facing string. */
  t: CommandTFunction;
  toast: {
    success: (msg: string) => void;
    error: (msg: string) => void;
    info: (msg: string) => void;
  };
}

export interface CommandDefinition {
  /** Stable identifier — used as React key, recent-storage key, and test selector */
  id: string;
  /** i18n key looked up by the hook */
  labelKey: string;
  /** English fallback shown when the i18n key is missing */
  labelFallback: string;
  /** Native semantic icon name (web parity: lucide icon component) */
  icon: LucideIcon;
  /** Section header the entry appears under */
  section: CommandSection;
  /** Extra search keywords for fuzzy matching */
  keywords?: string[];
  /** Optional keyboard shortcut hint (display-only, e.g. "⌘K", "g d") */
  shortcut?: string;
  /** Imperative side effect — invoked when the user picks the entry */
  perform: (ctx: CommandContext) => void | Promise<void>;
}

/**
 * Default commands available app-wide. Pages add page-specific commands by
 * registering ad-hoc entries via `useCommandRegistry`'s extensions API, but the
 * MVP keeps everything in this single source of truth.
 */
export const commandRegistry: CommandDefinition[] = [
  // ── Preferences ───────────────────────────────────────────────────────────
  {
    id: 'pref.theme.dark',
    labelKey: 'palette.cmd.themeDark',
    labelFallback: 'Theme: Dark',
    icon: Icons.moon,
    section: 'preferences',
    keywords: ['theme', 'dark', 'mode', 'night'],
    perform: ctx => ctx.setMode('dark'),
  },
  {
    id: 'pref.theme.light',
    labelKey: 'palette.cmd.themeLight',
    labelFallback: 'Theme: Light',
    icon: Icons.sun,
    section: 'preferences',
    keywords: ['theme', 'light', 'mode', 'day', 'bright'],
    perform: ctx => ctx.setMode('light'),
  },
  {
    id: 'pref.theme.oled',
    labelKey: 'palette.cmd.themeOled',
    labelFallback: 'Theme: OLED Black',
    icon: Icons.moon,
    section: 'preferences',
    keywords: ['theme', 'oled', 'black', 'mode', 'amoled'],
    perform: ctx => ctx.setMode('oled'),
  },
  {
    id: 'pref.theme.midnight',
    labelKey: 'palette.cmd.themeMidnight',
    labelFallback: 'Theme: Midnight Blue',
    icon: Icons.moon,
    section: 'preferences',
    keywords: ['theme', 'midnight', 'blue', 'mode'],
    perform: ctx => ctx.setMode('midnight'),
  },
  {
    id: 'pref.theme.auto',
    labelKey: 'palette.cmd.themeAuto',
    labelFallback: 'Theme: Auto (system)',
    icon: Icons.sunMoon,
    section: 'preferences',
    keywords: ['theme', 'auto', 'system', 'mode'],
    perform: ctx => ctx.setMode('auto'),
  },
  {
    id: 'pref.themePicker',
    labelKey: 'palette.cmd.themePicker',
    labelFallback: 'Open theme picker',
    icon: Icons.palette,
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
      // The native host subscribes (via subscribeCommandEvent) to open the
      // top-bar theme popover (no navigation away from the current page).
      emitCommandEvent(COMMAND_EVENT.openThemePopover);
    },
  },

  // ── Per-theme switch commands ──────────────────────
  // Surfacing every named theme so power users can `Cmd+K → tesla red → ↵`.
  {
    id: 'pref.theme.neonCyan',
    labelKey: 'palette.cmd.themeNeonCyan',
    labelFallback: 'Switch to Neon Cyan',
    icon: Icons.palette,
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
    icon: Icons.palette,
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
    icon: Icons.palette,
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
    icon: Icons.palette,
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
    icon: Icons.palette,
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
    icon: Icons.sunMoon,
    section: 'preferences',
    keywords: ['theme', 'toggle', 'dark', 'light', 'mode', 'switch'],
    perform: ctx => {
      // Read the current mode from the host-supplied flag (native replacement
      // for the web `document.documentElement.classList.contains('dark')`
      // read). This avoids needing to thread the mode through every command.
      const isDark = ctx.isDarkMode;
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
    icon: Icons.refresh,
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
    icon: Icons.notifications,
    section: 'actions',
    keywords: ['alert', 'rule', 'new', 'create', 'notification', 'notify'],
    perform: ctx => ctx.navigate('/notifications/studio'),
  },
  {
    id: 'action.alerts.test',
    labelKey: 'palette.cmd.testAlert',
    labelFallback: 'Send a test alert',
    icon: Icons.notificationsActive,
    section: 'actions',
    keywords: ['alert', 'test', 'notification', 'check', 'verify'],
    perform: ctx => ctx.navigate('/alert-studio?test=1'),
  },
  {
    id: 'action.notifications.history',
    labelKey: 'palette.cmd.notificationsHistory',
    labelFallback: 'Open notification history',
    icon: Icons.notificationsActive,
    section: 'actions',
    keywords: ['notifications', 'history', 'log', 'past'],
    perform: ctx => ctx.navigate('/notifications/inbox'),
  },
  {
    id: 'action.commands.history',
    labelKey: 'palette.cmd.commandHistory',
    labelFallback: 'Open command history',
    icon: Icons.workflow,
    section: 'actions',
    keywords: ['command', 'history', 'log', 'past', 'audit'],
    perform: ctx => ctx.navigate('/command-history'),
  },
  {
    id: 'action.security',
    labelKey: 'palette.cmd.securitySettings',
    labelFallback: 'Open security & access',
    icon: Icons.locked,
    section: 'actions',
    keywords: ['security', 'access', 'lock', 'safety', 'guard'],
    perform: ctx => ctx.navigate('/security-access'),
  },
  {
    id: 'action.system.status',
    labelKey: 'palette.cmd.systemStatus',
    labelFallback: 'View system status',
    icon: Icons.speed,
    section: 'actions',
    keywords: ['system', 'status', 'health', 'uptime', 'service'],
    perform: ctx => ctx.navigate('/system-status'),
  },
  {
    // open the global time-machine date picker.
    // The banner (rendered in Layout) listens for the
    // 'time-machine.open-picker' event and reveals an inline
    // datetime picker seeded with yesterday at noon. The
    // command is one-click — actually choosing a date is a separate
    // step inside the banner, which is fine because the chosen
    // timestamp must be picked deliberately rather than triggered by
    // a stray Enter on a fuzzy palette match.
    id: 'time-machine.open',
    labelKey: 'palette.cmd.timeMachineOpen',
    labelFallback: 'Open time machine',
    icon: Icons.history,
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
      emitCommandEvent(COMMAND_EVENT.timeMachineOpenPicker);
    },
  },
  {
    id: 'action.api.playground',
    labelKey: 'palette.cmd.apiPlayground',
    labelFallback: 'Open API playground',
    icon: Icons.terminal,
    section: 'actions',
    keywords: ['api', 'playground', 'rest', 'developer', 'test'],
    perform: ctx => ctx.navigate('/api-playground'),
  },
  {
    id: 'action.export',
    labelKey: 'palette.cmd.export',
    labelFallback: 'Open data export',
    icon: Icons.download,
    section: 'actions',
    keywords: ['export', 'csv', 'download', 'data', 'backup'],
    perform: ctx => ctx.navigate('/data-export'),
  },
  {
    id: 'action.settings',
    labelKey: 'palette.cmd.settings',
    labelFallback: 'Open settings',
    icon: Icons.settings,
    section: 'actions',
    keywords: ['settings', 'preferences', 'options', 'config'],
    perform: ctx => ctx.navigate('/settings'),
  },
  {
    id: 'action.shortcuts',
    labelKey: 'palette.cmd.shortcuts',
    labelFallback: 'Show keyboard shortcuts',
    icon: Icons.keyboard,
    section: 'actions',
    keywords: ['keyboard', 'shortcuts', 'keys', 'help', 'cheatsheet'],
    shortcut: '?',
    perform: () => {
      emitCommandEvent(COMMAND_EVENT.toggleKeyboardShortcuts);
    },
  },
  {
    // opens the in-app <FeedbackModal>. The
    // command id MUST stay literally "feedback.open"; the prompt's
    // audit gate scans this file for that exact string.
    id: 'feedback.open',
    labelKey: 'palette.cmd.feedback',
    labelFallback: 'Report bug / Send feedback',
    icon: Icons.bug,
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
      // The native host mounts the feedback modal and subscribes to this event
      // so the command stays decoupled from the React tree (the Cmd+K palette
      // can open the modal even when the sidebar is collapsed on mobile).
      emitCommandEvent(COMMAND_EVENT.openFeedbackModal);
    },
  },
  {
    id: 'action.tour',
    labelKey: 'palette.cmd.tour',
    labelFallback: 'Show tours',
    icon: Icons.helpCircle,
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
      emitCommandEvent(TOUR_OPEN_LAUNCHER_EVENT);
    },
  },
  {
    id: 'action.changelog.openModal',
    labelKey: 'palette.cmd.changelog',
    labelFallback: "What's new",
    icon: Icons.helpCircle,
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
      // The ChangelogModal mounts at the app root and subscribes to this event.
      // Referenced via the COMMAND_EVENT name table (not a hook import) to keep
      // the registry a pure-data module.
      emitCommandEvent(COMMAND_EVENT.openChangelog);
    },
  },

  // ── Dashboard customization ────────────────────────
  // The DashboardPage subscribes to these command events (`dashboard:*`) and
  // routes them through useDashboardLayout. The palette navigates to /dashboard
  // first so the listener is mounted, then dispatches on the next tick.
  {
    id: 'action.dashboard.edit',
    labelKey: 'palette.cmd.dashboardEdit',
    labelFallback: 'Edit dashboard layout',
    icon: Icons.edit,
    section: 'actions',
    keywords: [
      'dashboard',
      'edit',
      'customize',
      'rearrange',
      'layout',
      'widgets',
    ],
    shortcut: 'E',
    perform: ctx => {
      ctx.navigate('/dashboard');
      setTimeout(() => {
        emitCommandEvent(COMMAND_EVENT.dashboardToggleEdit);
      }, 50);
    },
  },
  {
    id: 'action.dashboard.switch',
    labelKey: 'palette.cmd.dashboardSwitch',
    labelFallback: 'Switch dashboard layout…',
    icon: Icons.layoutDashboard,
    section: 'actions',
    keywords: ['dashboard', 'switch', 'layout', 'preset', 'change'],
    perform: ctx => {
      ctx.navigate('/dashboard');
      setTimeout(() => {
        emitCommandEvent(COMMAND_EVENT.dashboardOpenSwitcher);
      }, 50);
    },
  },
  {
    id: 'action.dashboard.addWidget',
    labelKey: 'palette.cmd.dashboardAddWidget',
    labelFallback: 'Add widget to dashboard',
    icon: Icons.add,
    section: 'actions',
    keywords: ['dashboard', 'widget', 'add', 'panel', 'insert'],
    perform: ctx => {
      ctx.navigate('/dashboard');
      setTimeout(() => {
        emitCommandEvent(COMMAND_EVENT.dashboardAddWidget);
      }, 50);
    },
  },
  {
    id: 'action.dashboard.reset',
    labelKey: 'palette.cmd.dashboardReset',
    labelFallback: 'Reset dashboard to default',
    icon: Icons.undo,
    section: 'actions',
    keywords: ['dashboard', 'reset', 'default', 'clear', 'restore'],
    perform: ctx => {
      ctx.navigate('/dashboard');
      setTimeout(() => {
        emitCommandEvent(COMMAND_EVENT.dashboardReset);
      }, 50);
    },
  },

  // ── Privacy / housekeeping ─────────────────────────
  // Lets users on shared devices clear the per-command usage counts that drive
  // the palette's "Most Used" section. Pure local action — no server round-trip.
  {
    id: 'action.frecency.reset',
    labelKey: 'palette.cmd.frecencyReset',
    labelFallback: 'Reset command palette usage history',
    icon: Icons.undo,
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
      _resetFrecency();
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
 * Designed to keep the palette responsive without pulling in a fuzzy lib —
 * the catalog is only ~50 entries so a linear scan is fine.
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
  if (!query) {
    return 1;
  }
  const q = query.toLowerCase().trim();
  if (!q) {
    return 1;
  }
  const labelLower = label.toLowerCase();

  if (labelLower === q) {
    return 1000;
  }
  if (labelLower.startsWith(q)) {
    return 500 + q.length;
  }
  if (labelLower.includes(q)) {
    return 200 + q.length;
  }

  // Acronym (first letters of each word)
  const acronym = labelLower
    .split(/[\s\-_/:.]+/)
    .map(w => w[0] ?? '')
    .join('');
  if (acronym.includes(q)) {
    return 150;
  }

  for (const kw of keywords) {
    const k = kw.toLowerCase();
    if (k.startsWith(q)) {
      return 100;
    }
    if (k.includes(q)) {
      return 50;
    }
  }

  // Subsequence: every char of q appears in label in order ("btr" → "Battery").
  let i = 0;
  for (const ch of labelLower) {
    if (ch === q[i]) {
      i++;
    }
    if (i === q.length) {
      return 25;
    }
  }

  return 0;
}
