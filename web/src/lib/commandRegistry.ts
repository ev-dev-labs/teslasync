import type { ComponentType } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import type { TFunction } from 'i18next'
import type { ModeId, ThemeId } from '@/components/ui/ThemeProvider'
import type { LucideProps } from 'lucide-react'
import {
  Bell,
  BellRing,
  Download,
  Gauge,
  HelpCircle,
  Keyboard,
  Lock,
  Moon,
  Palette,
  RefreshCw,
  Settings,
  Sun,
  SunMoon,
  Terminal,
  Workflow,
} from 'lucide-react'

/**
 * Command registry — Phase 40 / Prompt 19.
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

export type LucideIcon = ComponentType<LucideProps>

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
    icon: Moon,
    section: 'preferences',
    keywords: ['theme', 'dark', 'mode', 'night'],
    perform: (ctx) => ctx.setMode('dark'),
  },
  {
    id: 'pref.theme.light',
    labelKey: 'palette.cmd.themeLight',
    labelFallback: 'Theme: Light',
    icon: Sun,
    section: 'preferences',
    keywords: ['theme', 'light', 'mode', 'day', 'bright'],
    perform: (ctx) => ctx.setMode('light'),
  },
  {
    id: 'pref.theme.oled',
    labelKey: 'palette.cmd.themeOled',
    labelFallback: 'Theme: OLED Black',
    icon: Moon,
    section: 'preferences',
    keywords: ['theme', 'oled', 'black', 'mode', 'amoled'],
    perform: (ctx) => ctx.setMode('oled'),
  },
  {
    id: 'pref.theme.midnight',
    labelKey: 'palette.cmd.themeMidnight',
    labelFallback: 'Theme: Midnight Blue',
    icon: Moon,
    section: 'preferences',
    keywords: ['theme', 'midnight', 'blue', 'mode'],
    perform: (ctx) => ctx.setMode('midnight'),
  },
  {
    id: 'pref.theme.auto',
    labelKey: 'palette.cmd.themeAuto',
    labelFallback: 'Theme: Auto (system)',
    icon: SunMoon,
    section: 'preferences',
    keywords: ['theme', 'auto', 'system', 'mode'],
    perform: (ctx) => ctx.setMode('auto'),
  },
  {
    id: 'pref.themePicker',
    labelKey: 'palette.cmd.themePicker',
    labelFallback: 'Open theme picker…',
    icon: Palette,
    section: 'preferences',
    keywords: ['theme', 'color', 'picker', 'preferences', 'appearance'],
    perform: (ctx) => ctx.navigate('/settings#appearance'),
  },

  // ── Actions ───────────────────────────────────────────────────────────────
  {
    id: 'action.refresh',
    labelKey: 'palette.cmd.refresh',
    labelFallback: 'Refresh data',
    icon: RefreshCw,
    section: 'actions',
    keywords: ['refresh', 'reload', 'update', 'invalidate', 'sync'],
    perform: async (ctx) => {
      await ctx.invalidateAll()
      ctx.toast.success(ctx.t('palette.toast.refreshed', 'Data refreshed'))
    },
  },
  {
    id: 'action.alerts.new',
    labelKey: 'palette.cmd.newAlert',
    labelFallback: 'Create new alert rule',
    icon: Bell,
    section: 'actions',
    keywords: ['alert', 'rule', 'new', 'create', 'notification', 'notify'],
    perform: (ctx) => ctx.navigate('/alert-studio'),
  },
  {
    id: 'action.alerts.test',
    labelKey: 'palette.cmd.testAlert',
    labelFallback: 'Send a test alert',
    icon: BellRing,
    section: 'actions',
    keywords: ['alert', 'test', 'notification', 'check', 'verify'],
    perform: (ctx) => ctx.navigate('/alert-studio?test=1'),
  },
  {
    id: 'action.notifications.history',
    labelKey: 'palette.cmd.notificationsHistory',
    labelFallback: 'Open notification history',
    icon: BellRing,
    section: 'actions',
    keywords: ['notifications', 'history', 'log', 'past'],
    perform: (ctx) => ctx.navigate('/notifications'),
  },
  {
    id: 'action.commands.history',
    labelKey: 'palette.cmd.commandHistory',
    labelFallback: 'Open command history',
    icon: Workflow,
    section: 'actions',
    keywords: ['command', 'history', 'log', 'past', 'audit'],
    perform: (ctx) => ctx.navigate('/command-history'),
  },
  {
    id: 'action.security',
    labelKey: 'palette.cmd.securitySettings',
    labelFallback: 'Open security & access',
    icon: Lock,
    section: 'actions',
    keywords: ['security', 'access', 'lock', 'safety', 'guard'],
    perform: (ctx) => ctx.navigate('/security-access'),
  },
  {
    id: 'action.system.status',
    labelKey: 'palette.cmd.systemStatus',
    labelFallback: 'View system status',
    icon: Gauge,
    section: 'actions',
    keywords: ['system', 'status', 'health', 'uptime', 'service'],
    perform: (ctx) => ctx.navigate('/system-status'),
  },
  {
    id: 'action.api.playground',
    labelKey: 'palette.cmd.apiPlayground',
    labelFallback: 'Open API playground',
    icon: Terminal,
    section: 'actions',
    keywords: ['api', 'playground', 'rest', 'developer', 'test'],
    perform: (ctx) => ctx.navigate('/api-playground'),
  },
  {
    id: 'action.export',
    labelKey: 'palette.cmd.export',
    labelFallback: 'Open data export',
    icon: Download,
    section: 'actions',
    keywords: ['export', 'csv', 'download', 'data', 'backup'],
    perform: (ctx) => ctx.navigate('/data-export'),
  },
  {
    id: 'action.settings',
    labelKey: 'palette.cmd.settings',
    labelFallback: 'Open settings',
    icon: Settings,
    section: 'actions',
    keywords: ['settings', 'preferences', 'options', 'config'],
    perform: (ctx) => ctx.navigate('/settings'),
  },
  {
    id: 'action.shortcuts',
    labelKey: 'palette.cmd.shortcuts',
    labelFallback: 'Show keyboard shortcuts',
    icon: Keyboard,
    section: 'actions',
    keywords: ['keyboard', 'shortcuts', 'keys', 'help', 'cheatsheet'],
    shortcut: '?',
    perform: () => {
      window.dispatchEvent(new CustomEvent('toggle-keyboard-shortcuts'))
    },
  },
  {
    id: 'action.help',
    labelKey: 'palette.cmd.help',
    labelFallback: 'Open documentation',
    icon: HelpCircle,
    section: 'actions',
    keywords: ['help', 'docs', 'documentation', 'manual', 'guide'],
    perform: (ctx) => ctx.navigate('/changelog'),
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
