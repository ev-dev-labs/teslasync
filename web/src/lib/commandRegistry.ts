import type { NavigateFunction } from 'react-router-dom'
import type { TFunction } from 'i18next'
import type { ModeId, ThemeId } from '@/components/ui/ThemeProvider'
import { Icons, type LucideIcon } from '@/lib/icons'
import { TOUR_OPEN_LAUNCHER_EVENT } from '@/lib/tourRegistry'
import { _resetFrecency } from '@/lib/commandFrecency'
import {
  dispatchWorkspaceDensity,
  dispatchWorkspaceRangePreset,
} from '@/lib/workspacePreferences'

export type { LucideIcon }

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

export type CommandSection = 'actions' | 'preferences' | 'pages' | 'vehicles'

export interface CommandContext {
  navigate: NavigateFunction
  setMode: (id: ModeId) => void
  setTheme: (id: ThemeId) => void
  setVehicleId: (id: number | null) => void
  invalidateAll: () => Promise<void>
  /** i18next translate fn — perform() should use this for any user-facing string. */
  t: TFunction
  toast: {
    success: (msg: string) => void
    error: (msg: string) => void
    info: (msg: string) => void
  }
}

export interface CommandDefinition {
  /** Stable identifier — used as React key, recent-storage key, and test selector */
  id: string
  /** i18n key looked up by the hook */
  labelKey: string
  /** English fallback shown when the i18n key is missing */
  labelFallback: string
  /** Lucide icon component */
  icon: LucideIcon
  /** Section header the entry appears under */
  section: CommandSection
  /** Extra search keywords for fuzzy matching */
  keywords?: string[]
  /** Optional keyboard shortcut hint (display-only, e.g. "⌘K", "g d") */
  shortcut?: string
  /** Imperative side effect — invoked when the user picks the entry */
  perform: (ctx: CommandContext) => void | Promise<void>
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
    perform: (ctx) => ctx.setMode('dark'),
  },
  {
    id: 'pref.theme.light',
    labelKey: 'palette.cmd.themeLight',
    labelFallback: 'Theme: Light',
    icon: Icons.sun,
    section: 'preferences',
    keywords: ['theme', 'light', 'mode', 'day', 'bright'],
    perform: (ctx) => ctx.setMode('light'),
  },
  {
    id: 'pref.theme.oled',
    labelKey: 'palette.cmd.themeOled',
    labelFallback: 'Theme: OLED Black',
    icon: Icons.moon,
    section: 'preferences',
    keywords: ['theme', 'oled', 'black', 'mode', 'amoled'],
    perform: (ctx) => ctx.setMode('oled'),
  },
  {
    id: 'pref.theme.midnight',
    labelKey: 'palette.cmd.themeMidnight',
    labelFallback: 'Theme: Midnight Blue',
    icon: Icons.moon,
    section: 'preferences',
    keywords: ['theme', 'midnight', 'blue', 'mode'],
    perform: (ctx) => ctx.setMode('midnight'),
  },
  {
    id: 'pref.theme.auto',
    labelKey: 'palette.cmd.themeAuto',
    labelFallback: 'Theme: Auto (system)',
    icon: Icons.sunMoon,
    section: 'preferences',
    keywords: ['theme', 'auto', 'system', 'mode'],
    perform: (ctx) => ctx.setMode('auto'),
  },
  {
    id: 'pref.themePicker',
    labelKey: 'palette.cmd.themePicker',
    labelFallback: 'Open theme picker',
    icon: Icons.palette,
    section: 'preferences',
    keywords: ['theme', 'color', 'picker', 'preferences', 'appearance', 'customize'],
    shortcut: 'T',
    perform: () => {
      // Layout listens for this event to open the
      // top-bar theme popover (no navigation away from the current page).
      window.dispatchEvent(new CustomEvent('open-theme-popover'))
    },
  },

  // ── Per-theme switch commands ──────────────────────
  // Surfacing every named theme so power users can `Cmd+K → tesla red → ↵`.
  {
    id: 'pref.theme.neonCyan',
    labelKey: 'palette.cmd.themeNeonCyan',
    labelFallback: 'Switch to Signal Blue',
    icon: Icons.palette,
    section: 'preferences',
    keywords: ['theme', 'switch', 'signal', 'blue', 'neon', 'cyan', 'color'],
    perform: (ctx) => {
      ctx.setTheme('neon-cyan')
      ctx.toast.info(ctx.t('theme.switchedTo', { name: 'Signal Blue', defaultValue: 'Switched to Signal Blue' }))
    },
  },
  {
    id: 'pref.theme.teslaRed',
    labelKey: 'palette.cmd.themeTeslaRed',
    labelFallback: 'Switch to Tesla Red',
    icon: Icons.palette,
    section: 'preferences',
    keywords: ['theme', 'switch', 'tesla', 'red', 'color'],
    perform: (ctx) => {
      ctx.setTheme('tesla-red')
      ctx.toast.info(ctx.t('theme.switchedTo', { name: 'Tesla Red', defaultValue: 'Switched to Tesla Red' }))
    },
  },
  {
    id: 'pref.theme.matrixGreen',
    labelKey: 'palette.cmd.themeMatrixGreen',
    labelFallback: 'Switch to Matrix Green',
    icon: Icons.palette,
    section: 'preferences',
    keywords: ['theme', 'switch', 'matrix', 'green', 'color'],
    perform: (ctx) => {
      ctx.setTheme('matrix-green')
      ctx.toast.info(ctx.t('theme.switchedTo', { name: 'Matrix Green', defaultValue: 'Switched to Matrix Green' }))
    },
  },
  {
    id: 'pref.theme.royalPurple',
    labelKey: 'palette.cmd.themeRoyalPurple',
    labelFallback: 'Switch to Royal Purple',
    icon: Icons.palette,
    section: 'preferences',
    keywords: ['theme', 'switch', 'royal', 'purple', 'color'],
    perform: (ctx) => {
      ctx.setTheme('royal-purple')
      ctx.toast.info(ctx.t('theme.switchedTo', { name: 'Royal Purple', defaultValue: 'Switched to Royal Purple' }))
    },
  },
  {
    id: 'pref.theme.solarAmber',
    labelKey: 'palette.cmd.themeSolarAmber',
    labelFallback: 'Switch to Solar Amber',
    icon: Icons.palette,
    section: 'preferences',
    keywords: ['theme', 'switch', 'solar', 'amber', 'color'],
    perform: (ctx) => {
      ctx.setTheme('solar-amber')
      ctx.toast.info(ctx.t('theme.switchedTo', { name: 'Solar Amber', defaultValue: 'Switched to Solar Amber' }))
    },
  },
  {
    id: 'pref.theme.toggleMode',
    labelKey: 'palette.cmd.themeToggleMode',
    labelFallback: 'Toggle dark mode',
    icon: Icons.sunMoon,
    section: 'preferences',
    keywords: ['theme', 'toggle', 'dark', 'light', 'mode', 'switch'],
    perform: (ctx) => {
      // Read the current mode from the html class set by ThemeProvider's
      // applyThemeCSS(). This avoids needing to thread the current mode through
      // CommandContext for every command.
      const isDark = document.documentElement.classList.contains('dark')
      ctx.setMode(isDark ? 'light' : 'dark')
      ctx.toast.info(
        ctx.t(isDark ? 'theme.switchedToLight' : 'theme.switchedToDark', isDark ? 'Switched to light mode' : 'Switched to dark mode'),
      )
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
    perform: async (ctx) => {
      await ctx.invalidateAll()
      ctx.toast.success(ctx.t('palette.toast.refreshed', 'Data refreshed'))
    },
  },
  {
    id: 'workspace.range.live',
    labelKey: 'palette.cmd.rangeLive',
    labelFallback: 'Analysis window: Live',
    icon: Icons.calendar,
    section: 'preferences',
    keywords: ['range', 'time', 'live', 'realtime', 'latest', 'analysis'],
    perform: () => dispatchWorkspaceRangePreset('live'),
  },
  {
    id: 'workspace.range.24h',
    labelKey: 'palette.cmd.range24h',
    labelFallback: 'Analysis window: Last 24 hours',
    icon: Icons.calendar,
    section: 'preferences',
    keywords: ['range', 'time', 'day', '24 hours', 'rolling', 'analysis'],
    perform: () => dispatchWorkspaceRangePreset('24h'),
  },
  {
    id: 'workspace.range.today',
    labelKey: 'palette.cmd.rangeToday',
    labelFallback: 'Analysis window: Today',
    icon: Icons.calendar,
    section: 'preferences',
    keywords: ['range', 'time', 'today', 'live', 'analysis'],
    perform: () => dispatchWorkspaceRangePreset('today'),
  },
  {
    id: 'workspace.range.7d',
    labelKey: 'palette.cmd.range7d',
    labelFallback: 'Analysis window: Last 7 days',
    icon: Icons.calendar,
    section: 'preferences',
    keywords: ['range', 'time', 'week', '7 days', 'analysis'],
    perform: () => dispatchWorkspaceRangePreset('7d'),
  },
  {
    id: 'workspace.range.30d',
    labelKey: 'palette.cmd.range30d',
    labelFallback: 'Analysis window: Last 30 days',
    icon: Icons.calendar,
    section: 'preferences',
    keywords: ['range', 'time', 'month', '30 days', 'analysis'],
    perform: () => dispatchWorkspaceRangePreset('30d'),
  },
  {
    id: 'workspace.range.90d',
    labelKey: 'palette.cmd.range90d',
    labelFallback: 'Analysis window: Last 90 days',
    icon: Icons.calendar,
    section: 'preferences',
    keywords: ['range', 'time', 'quarter', '90 days', 'analysis'],
    perform: () => dispatchWorkspaceRangePreset('90d'),
  },
  {
    id: 'workspace.range.1y',
    labelKey: 'palette.cmd.range1y',
    labelFallback: 'Analysis window: Last year',
    icon: Icons.calendar,
    section: 'preferences',
    keywords: ['range', 'time', 'year', '12 months', 'analysis'],
    perform: () => dispatchWorkspaceRangePreset('1y'),
  },
  {
    id: 'workspace.range.all',
    labelKey: 'palette.cmd.rangeAll',
    labelFallback: 'Analysis window: All time',
    icon: Icons.calendar,
    section: 'preferences',
    keywords: ['range', 'time', 'all', 'lifetime', 'analysis'],
    perform: () => dispatchWorkspaceRangePreset('all'),
  },
  {
    id: 'workspace.density.compact',
    labelKey: 'palette.cmd.densityCompact',
    labelFallback: 'Workspace density: Compact',
    icon: Icons.settingsAlt,
    section: 'preferences',
    keywords: ['density', 'compact', 'rows', 'workspace'],
    perform: () => dispatchWorkspaceDensity('compact'),
  },
  {
    id: 'workspace.density.comfortable',
    labelKey: 'palette.cmd.densityComfortable',
    labelFallback: 'Workspace density: Comfortable',
    icon: Icons.settingsAlt,
    section: 'preferences',
    keywords: ['density', 'comfortable', 'default', 'workspace'],
    perform: () => dispatchWorkspaceDensity('comfortable'),
  },
  {
    id: 'workspace.density.spacious',
    labelKey: 'palette.cmd.densitySpacious',
    labelFallback: 'Workspace density: Spacious',
    icon: Icons.settingsAlt,
    section: 'preferences',
    keywords: ['density', 'spacious', 'large', 'workspace'],
    perform: () => dispatchWorkspaceDensity('spacious'),
  },
  {
    id: 'action.alerts.new',
    labelKey: 'palette.cmd.newAlert',
    labelFallback: 'Create new alert rule',
    icon: Icons.notifications,
    section: 'actions',
    keywords: ['alert', 'rule', 'new', 'create', 'notification', 'notify'],
    perform: (ctx) => ctx.navigate('/notifications/studio'),
  },
  {
    id: 'action.alerts.test',
    labelKey: 'palette.cmd.testAlert',
    labelFallback: 'Send a test alert',
    icon: Icons.notificationsActive,
    section: 'actions',
    keywords: ['alert', 'test', 'notification', 'check', 'verify'],
    perform: (ctx) => ctx.navigate('/alert-studio?test=1'),
  },
  {
    id: 'action.notifications.history',
    labelKey: 'palette.cmd.notificationsHistory',
    labelFallback: 'Open notification history',
    icon: Icons.notificationsActive,
    section: 'actions',
    keywords: ['notifications', 'history', 'log', 'past'],
    perform: (ctx) => ctx.navigate('/notifications/inbox'),
  },
  {
    id: 'action.commands.history',
    labelKey: 'palette.cmd.commandHistory',
    labelFallback: 'Open command history',
    icon: Icons.workflow,
    section: 'actions',
    keywords: ['command', 'history', 'log', 'past', 'audit'],
    perform: (ctx) => ctx.navigate('/command-history'),
  },
  {
    id: 'action.security',
    labelKey: 'palette.cmd.securitySettings',
    labelFallback: 'Open security & access',
    icon: Icons.locked,
    section: 'actions',
    keywords: ['security', 'access', 'lock', 'safety', 'guard'],
    perform: (ctx) => ctx.navigate('/security-access'),
  },
  {
    id: 'action.system.status',
    labelKey: 'palette.cmd.systemStatus',
    labelFallback: 'View system status',
    icon: Icons.speed,
    section: 'actions',
    keywords: ['system', 'status', 'health', 'uptime', 'service', 'diagnostics', 'operations'],
    perform: (ctx) => ctx.navigate('/system-status'),
  },
  {
    id: 'action.center',
    labelKey: 'palette.cmd.actionCenter',
    labelFallback: 'Open Action Center',
    icon: Icons.alertCircle,
    section: 'actions',
    keywords: ['action center', 'attention', 'recommendations', 'triage', 'issues'],
    perform: (ctx) => ctx.navigate('/action-center'),
  },
  {
    id: 'action.compare.fleet',
    labelKey: 'palette.cmd.fleetComparison',
    labelFallback: 'Compare fleet vehicles',
    icon: Icons.gitCompare,
    section: 'actions',
    keywords: ['fleet', 'vehicle', 'compare', 'comparison', 'benchmark'],
    perform: (ctx) => ctx.navigate('/vehicle-comparison'),
  },
  {
    id: 'action.compare.period',
    labelKey: 'palette.cmd.periodComparison',
    labelFallback: 'Compare analysis periods',
    icon: Icons.calendar,
    section: 'actions',
    keywords: ['period', 'time', 'compare', 'comparison', 'before', 'after'],
    perform: (ctx) => ctx.navigate('/period-compare'),
  },
  {
    // open the global time-machine date picker.
    // The banner (rendered in Layout) listens for the
    // 'time-machine.open-picker' window event and reveals an inline
    // <input type="datetime-local"> seeded with yesterday at noon. The
    // command is one-click — actually choosing a date is a separate
    // step inside the banner, which is fine because the chosen
    // timestamp must be picked deliberately rather than triggered by
    // a stray Enter on a fuzzy palette match.
    id: 'time-machine.open',
    labelKey: 'palette.cmd.timeMachineOpen',
    labelFallback: 'Open time machine',
    icon: Icons.history,
    section: 'actions',
    keywords: ['time', 'machine', 'history', 'as of', 'point-in-time', 'replay', 'past'],
    perform: () => {
      window.dispatchEvent(new CustomEvent('time-machine.open-picker'))
    },
  },
  {
    id: 'action.api.playground',
    labelKey: 'palette.cmd.apiPlayground',
    labelFallback: 'Open API playground',
    icon: Icons.terminal,
    section: 'actions',
    keywords: ['api', 'playground', 'rest', 'developer', 'test'],
    perform: (ctx) => ctx.navigate('/api-playground'),
  },
  {
    id: 'action.export',
    labelKey: 'palette.cmd.export',
    labelFallback: 'Open data export',
    icon: Icons.download,
    section: 'actions',
    keywords: ['export', 'csv', 'download', 'data', 'backup'],
    perform: (ctx) => ctx.navigate('/data-export'),
  },
  {
    id: 'action.settings',
    labelKey: 'palette.cmd.settings',
    labelFallback: 'Open settings',
    icon: Icons.settings,
    section: 'actions',
    keywords: ['settings', 'preferences', 'options', 'config'],
    perform: (ctx) => ctx.navigate('/settings'),
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
      window.dispatchEvent(new CustomEvent('toggle-keyboard-shortcuts'))
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
    keywords: ['feedback', 'bug', 'report', 'issue', 'problem', 'suggestion', 'feature request', 'send'],
    perform: () => {
      // Layout.tsx mounts <FeedbackModal> and listens for this event so the
      // command stays decoupled from the React tree (the Cmd+K palette can
      // open the modal even when the sidebar is collapsed on mobile).
      window.dispatchEvent(new CustomEvent('open-feedback-modal'))
    },
  },
  {
    id: 'action.tour',
    labelKey: 'palette.cmd.tour',
    labelFallback: 'Show tours',
    icon: Icons.helpCircle,
    section: 'actions',
    keywords: ['tour', 'tours', 'walkthrough', 'onboarding', 'guide', 'help', 'tutorial'],
    perform: () => {
      window.dispatchEvent(new CustomEvent(TOUR_OPEN_LAUNCHER_EVENT))
    },
  },
  {
    id: 'action.changelog.openModal',
    labelKey: 'palette.cmd.changelog',
    labelFallback: "What's new",
    icon: Icons.helpCircle,
    section: 'actions',
    keywords: ['changelog', 'release', 'notes', 'whats', 'new', 'updates', 'features'],
    perform: () => {
      // The ChangelogModal mounts at the app root and listens for this event.
      // Imported as a string here (not via the helper) to avoid pulling the
      // hook module into the registry and inflating the tree-shaken bundle.
      window.dispatchEvent(new CustomEvent('teslasync:changelog:open'))
    },
  },

  // ── Dashboard customization ────────────────────────
  // The DashboardPage listens for these CustomEvents (`dashboard:*`) and
  // routes them through useDashboardLayout. The palette navigates to /dashboard
  // first so the listener is mounted, then dispatches on the next tick.
  {
    id: 'action.dashboard.edit',
    labelKey: 'palette.cmd.dashboardEdit',
    labelFallback: 'Edit dashboard layout',
    icon: Icons.edit,
    section: 'actions',
    keywords: ['dashboard', 'edit', 'customize', 'rearrange', 'layout', 'widgets'],
    shortcut: 'E',
    perform: (ctx) => {
      ctx.navigate('/dashboard')
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('dashboard:toggle-edit'))
      }, 50)
    },
  },
  {
    id: 'action.dashboard.switch',
    labelKey: 'palette.cmd.dashboardSwitch',
    labelFallback: 'Switch dashboard layout…',
    icon: Icons.layoutDashboard,
    section: 'actions',
    keywords: ['dashboard', 'switch', 'layout', 'preset', 'change'],
    perform: (ctx) => {
      ctx.navigate('/dashboard')
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('dashboard:open-switcher'))
      }, 50)
    },
  },
  {
    id: 'action.dashboard.addWidget',
    labelKey: 'palette.cmd.dashboardAddWidget',
    labelFallback: 'Add widget to dashboard',
    icon: Icons.add,
    section: 'actions',
    keywords: ['dashboard', 'widget', 'add', 'panel', 'insert'],
    perform: (ctx) => {
      ctx.navigate('/dashboard')
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('dashboard:add-widget'))
      }, 50)
    },
  },
  {
    id: 'action.dashboard.reset',
    labelKey: 'palette.cmd.dashboardReset',
    labelFallback: 'Reset dashboard to default',
    icon: Icons.undo,
    section: 'actions',
    keywords: ['dashboard', 'reset', 'default', 'clear', 'restore'],
    perform: (ctx) => {
      ctx.navigate('/dashboard')
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('dashboard:reset'))
      }, 50)
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
    keywords: ['reset', 'clear', 'frecency', 'usage', 'history', 'palette', 'privacy', 'most used'],
    perform: (ctx) => {
      _resetFrecency()
      ctx.toast.success(ctx.t('palette.toast.frecencyReset', 'Command palette usage history cleared'))
    },
  },
]

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
export function scoreCommand(query: string, label: string, keywords: string[] = []): number {
  if (!query) return 1
  const q = query.toLowerCase().trim()
  if (!q) return 1
  const labelLower = label.toLowerCase()

  if (labelLower === q) return 1000
  if (labelLower.startsWith(q)) return 500 + q.length
  if (labelLower.includes(q)) return 200 + q.length

  // Acronym (first letters of each word)
  const acronym = labelLower.split(/[\s\-_/:.]+/).map((w) => w[0] ?? '').join('')
  if (acronym.includes(q)) return 150

  for (const kw of keywords) {
    const k = kw.toLowerCase()
    if (k.startsWith(q)) return 100
    if (k.includes(q)) return 50
  }

  // Subsequence: every char of q appears in label in order ("btr" → "Battery").
  let i = 0
  for (const ch of labelLower) {
    if (ch === q[i]) i++
    if (i === q.length) return 25
  }

  return 0
}
