/**
 * Design tokens for TeslaSync UI component library.
 * Single source of truth for spacing, sizing, color mappings, and animation constants.
 */

// ── Neon color variants used across Badge, IconBox, Button, etc. ──

export type NeonColor = 'cyan' | 'green' | 'red' | 'purple' | 'amber' | 'blue' | 'neutral'

// Historical variant names remain compatible; presentation uses semantic roles.
export const neonColorMap: Record<NeonColor, {
  text: string
  bg: string
  ring: string
  border: string
  glow: string
  dot: string
}> = {
  cyan:   { text: 'text-[var(--semantic-info)]', bg: 'bg-[var(--semantic-info-bg)]', ring: 'ring-[var(--semantic-info-border)]', border: 'border-[var(--semantic-info-border)]', glow: 'shadow-none', dot: 'bg-[var(--semantic-info)]' },
  green:  { text: 'text-[var(--semantic-success)]', bg: 'bg-[var(--semantic-success-bg)]', ring: 'ring-[var(--semantic-success-border)]', border: 'border-[var(--semantic-success-border)]', glow: 'shadow-none', dot: 'bg-[var(--semantic-success)]' },
  red:    { text: 'text-[var(--semantic-danger)]', bg: 'bg-[var(--semantic-danger-bg)]', ring: 'ring-[var(--semantic-danger-border)]', border: 'border-[var(--semantic-danger-border)]', glow: 'shadow-none', dot: 'bg-[var(--semantic-danger)]' },
  purple: { text: 'text-[var(--semantic-purple)]', bg: 'bg-[var(--semantic-purple-bg)]', ring: 'ring-[var(--semantic-purple-border)]', border: 'border-[var(--semantic-purple-border)]', glow: 'shadow-none', dot: 'bg-[var(--semantic-purple)]' },
  amber:  { text: 'text-[var(--semantic-warning)]', bg: 'bg-[var(--semantic-warning-bg)]', ring: 'ring-[var(--semantic-warning-border)]', border: 'border-[var(--semantic-warning-border)]', glow: 'shadow-none', dot: 'bg-[var(--semantic-warning)]' },
  blue:   { text: 'text-[var(--semantic-info)]', bg: 'bg-[var(--semantic-info-bg)]', ring: 'ring-[var(--semantic-info-border)]', border: 'border-[var(--semantic-info-border)]', glow: 'shadow-none', dot: 'bg-[var(--semantic-info)]' },
  neutral: { text: 'text-[var(--text-secondary)]', bg: 'bg-[var(--surface-2)]', ring: 'ring-[var(--border-default)]', border: 'border-[var(--border-default)]', glow: 'shadow-none', dot: 'bg-[var(--text-secondary)]' },
}

// ── Semantic color aliases ──

export type SemanticColor = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export const semanticToNeon: Record<SemanticColor, NeonColor> = {
  success: 'green',
  warning: 'amber',
  danger: 'red',
  info: 'cyan',
  neutral: 'neutral',
}

// ── Icon sizes ──

export const iconSize = {
  xs: 'h-3 w-3',
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-5 w-5',
  xl: 'h-6 w-6',
} as const

export type IconSize = keyof typeof iconSize

// ── Common inline card pattern (replaces repeated class strings) ──

export const glassCardClasses = {
  sm: 'p-3 rounded-panel bg-[var(--panel-bg)] border border-[var(--panel-border)] shadow-e1',
  md: 'p-4 rounded-panel bg-[var(--panel-bg)] border border-[var(--panel-border)] shadow-e1',
  lg: 'p-5 rounded-panel bg-[var(--panel-bg)] border border-[var(--panel-border)] shadow-e1',
} as const

// ── Table styling tokens ──
//
// Includes sticky-header, selection-row, bulk-bar, resizer-handle, and
// expanded-row tokens used by DataTable's optional features.

export const tableTokens = {
  frame: 'min-w-0 max-w-full space-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-1)] p-3 shadow-e1',
  toolbar: 'flex flex-wrap items-center justify-between gap-2',
  wrapper: 'w-full border-collapse text-sm text-[var(--text-primary)]',
  head: 'border-b border-[var(--border-default)] bg-[var(--surface-2)] text-[var(--text-secondary)] text-xs normal-case tracking-normal',
  headCell: 'px-4 py-3.5 text-left font-semibold',
  body: 'divide-y divide-[var(--border-subtle)]',
  row: 'align-middle even:bg-[var(--surface-2)] hover:!bg-[var(--control-bg-hover)] transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--text-secondary)]',
  cell: 'px-4 py-3.5',
  /** Wrapper applied when stickyHeader / maxHeight is in use — needs scroll + relative for sticky thead. */
  scrollContainer: 'relative overflow-auto rounded-panel border border-[var(--border-default)]',
  /** Applied to <thead> rows when stickyHeader is true. The bg matches GlassPanel
   *  surface so rows scrolling underneath don't bleed through. z-20 keeps the
   *  sticky thead above selected-row z-10 hover states. */
  stickyHead: 'sticky top-0 z-20 bg-[var(--surface-2)] backdrop-blur-sm',
  /** Visual treatment for selected rows. */
  rowSelected: '!bg-[var(--control-bg)] [&>td:first-child]:shadow-[inset_3px_0_0_var(--text-secondary)]',
  groupStart: 'border-l border-[var(--border-subtle)]',
  semantic: '[&_thead]:border-b [&_thead]:border-[var(--border-default)] [&_thead]:bg-[var(--surface-2)] [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold [&_th]:normal-case [&_th]:tracking-normal [&_th]:text-[var(--text-secondary)] [&_td]:px-3 [&_td]:py-2 [&_tbody_tr]:align-middle [&_tbody_tr]:border-b [&_tbody_tr]:border-[var(--border-subtle)] [&_tbody_tr:nth-child(even)]:bg-[var(--surface-2)] [&_tbody_tr:hover]:bg-[var(--control-bg-hover)] [&_tbody_tr:focus-within]:bg-[var(--control-bg-hover)]',
  /** Container for the bulk-action toolbar that appears above the table. */
  bulkBar:
    'flex flex-wrap items-center gap-2 px-3 py-2 mb-2 rounded-lg ' +
    'border border-[var(--border-default)] bg-[var(--control-bg)] text-sm text-[var(--text-primary)]',
  /** Width of the leading checkbox/chevron columns. */
  leadingColWidth: 'w-10',
  /** The drag handle on the right edge of resizable column headers. */
  resizer:
    'absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none ' +
    'opacity-0 hover:opacity-100 hover:bg-[var(--text-muted)] transition-opacity ' +
    'focus-visible:opacity-100 focus-visible:bg-[var(--text-secondary)] outline-none',
  /** Cell holding `renderExpanded` content under an expanded row. */
  expandedCell:
    'px-4 py-3 bg-[var(--surface-2)] border-l-2 border-[var(--border-default)]',
} as const

// ── Animation ──

export const animationDuration = {
  fast: 0.15,
  normal: 0.2,
  slow: 0.3,
  stagger: 0.06,
} as const

export const transitions = {
  spring: { type: 'spring' as const, stiffness: 300, damping: 30 },
  ease: { duration: animationDuration.normal, ease: 'easeOut' as const },
  slow: { duration: animationDuration.slow, ease: 'easeOut' as const },
} as const

// ── Motion tokens ─────────────────────────────────────────────────────────────
//
// One source of truth for transition durations and easings used across the
// app. Three semantic buckets so motion timings can't drift between
// components:
//   - fast   (150ms): hover, focus, micro-feedback
//   - normal (250ms): entrance, exit, panel transitions
//   - slow   (400ms): page transitions, large layout shifts
//
// Tailwind exposes the same buckets as `duration-fast | duration-normal |
// duration-slow` (see tailwind.config.js → transitionDuration), backed by the
// `--motion-duration-*` CSS variables in index.css. The CSS variables
// collapse to 0ms under `prefers-reduced-motion: reduce`, so every consumer
// of the tokens automatically respects the user's OS-level motion
// preference — no per-component branching required.
//
// `auditMotionTokens.mjs` flags any raw `duration-NNN` Tailwind class
// outside this token system. Use the new utilities, not raw numbers.

export const motion = {
  duration: {
    fast: '150ms',
    normal: '250ms',
    slow: '400ms',
  },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    accelerate: 'cubic-bezier(0.3, 0, 1, 1)',
    decelerate: 'cubic-bezier(0, 0, 0, 1)',
  },
  /**
   * Tailwind class shortcuts mapped to the same buckets. Prefer the
   * semantic utility names (`duration-fast`, `duration-normal`,
   * `duration-slow`) directly in className strings — this map exists for
   * JS code that needs to reference the buckets programmatically without
   * hard-coding raw `duration-NNN` strings inline.
   */
  twDuration: {
    fast: 'duration-fast',
    normal: 'duration-normal',
    slow: 'duration-slow',
  } as const,
} as const

export type MotionDuration = keyof typeof motion.duration
export type MotionEasing = keyof typeof motion.easing

// ── Typography tokens ──
//
// One source of truth for every text size / weight / color / role used in the app.
// Prefer the composed `role` strings via the <Heading>/<Text> components in
// @/components/ui — fall back to size/weight/color granular tokens only for
// one-offs that don't fit a role.

export const typography = {
  /** Type scale — mirrors Tailwind. Pick by intent, not by px. */
  size: {
    '2xs': 'text-2xs',     // 10px — micro labels, table footers
    xs: 'text-xs',         // 12px — chip text, dense table cells
    sm: 'text-sm',         // 14px — default body in dense UIs
    base: 'text-base',     // 16px — comfortable body
    lg: 'text-lg',         // 18px — small headings, prominent body
    xl: 'text-xl',         // 20px — panel titles
    '2xl': 'text-2xl',     // 24px — section titles
    '3xl': 'text-3xl',     // 30px — page titles, big metrics
  },

  weight: {
    regular: 'font-normal',
    medium: 'font-medium',
    semibold: 'font-semibold',
    bold: 'font-bold',
  },

  /** Theme-aware text colors. Always prefer these over text-white/N or text-gray-N. */
  color: {
    primary: 'text-[var(--text-primary)]',
    secondary: 'text-[var(--text-secondary)]',
    muted: 'text-[var(--text-muted)]',
    // Theme- and forced-colors-safe: resolve through the --text-* vars so
    // contrast holds in every mode (dark/light/oled/…/High-Contrast) instead
    // of the non-adaptive text-white/N literals these used to carry.
    subtle: 'text-[var(--text-secondary)]',
    disabled: 'text-[var(--text-muted)]',
    // Text placed on an inverted surface (e.g. a flipped tooltip / accent
    // fill). --text-inverse is dark in dark themes and light in light themes
    // (see index.css :root + :root.light-mode).
    inverse: 'text-[var(--text-inverse)]',
    // Text / icons on a solid, saturated accent fill (bright neon button,
    // checkbox tick). Stays dark in every theme because the fill stays bright
    // (see index.css --text-on-accent — no light-mode override).
    onAccent: 'text-[var(--text-on-accent)]',
  },

  family: {
    sans: 'font-sans',
    mono: 'font-mono',
  },

  /**
   * Composed roles — the canonical class string for each text "kind" the app renders.
   * Use these via <Heading level="..."> / <Text variant="..."> in components/ui.
   */
  role: {
    pageTitle: 'text-2xl sm:text-3xl font-bold text-[var(--text-primary)]',
    sectionTitle: 'text-xl font-semibold text-[var(--text-primary)]',
    panelTitle: 'text-lg font-semibold text-[var(--text-primary)]',
    subhead: 'text-sm font-medium text-[var(--text-secondary)]',
    body: 'text-sm text-[var(--text-primary)]',
    bodySm: 'text-sm text-[var(--text-secondary)]',
    caption: 'text-xs text-[var(--text-muted)]',
    label: 'text-xs font-medium text-[var(--text-muted)]',
    metricValue: 'text-2xl sm:text-3xl font-bold text-[var(--text-primary)] tabular-nums',
    metricLabel: 'text-xs font-medium text-[var(--text-muted)]',
    code: 'text-xs font-mono text-[var(--text-primary)]',
    helper: 'text-xs text-[var(--text-muted)]',
    error: 'text-xs text-[var(--semantic-danger)]',
  },
} as const

export type TypographyRole = keyof typeof typography.role
export type TypographySize = keyof typeof typography.size
export type TypographyWeight = keyof typeof typography.weight
export type TypographyColor = keyof typeof typography.color

// ── Severity tokens — single source of truth for alert/notification styling ──
//
// Used by <SeverityBadge>, <SeverityIcon>, <StatusDot>, and <ConfirmDialog>. The
// canonical wire-level severities are 'info' | 'warn' | 'critical'; 'success' is
// a UI-only success affordance. Use `normalizeSeverity()` to map any incoming
// string (including the legacy 'warning', 'error', 'fatal', 'ok' aliases) onto
// the canonical Severity union before reading from this map.

export type Severity = 'info' | 'warn' | 'critical' | 'success'

export type SeverityIconName = 'Info' | 'AlertTriangle' | 'AlertOctagon' | 'CheckCircle'

export interface SeverityTokens {
  /** Background tint — soft, theme-aware */
  bg: string
  /** Border color */
  border: string
  /** Foreground icon/text color (NOT body text — used for icons and small labels only) */
  fg: string
  /** Lucide icon name */
  icon: SeverityIconName
  /** Subtle dot for inline status — for `<StatusDot>` */
  dot: string
}

export const severityTokens: Record<Severity, SeverityTokens> = {
  info: {
    bg: neonColorMap.cyan.bg,
    border: neonColorMap.cyan.border,
    fg: neonColorMap.cyan.text,
    icon: 'Info',
    dot: neonColorMap.cyan.dot,
  },
  warn: {
    bg: neonColorMap.amber.bg,
    border: neonColorMap.amber.border,
    fg: neonColorMap.amber.text,
    icon: 'AlertTriangle',
    dot: neonColorMap.amber.dot,
  },
  critical: {
    bg: neonColorMap.red.bg,
    border: neonColorMap.red.border,
    fg: neonColorMap.red.text,
    icon: 'AlertOctagon',
    dot: neonColorMap.red.dot,
  },
  success: {
    bg: neonColorMap.green.bg,
    border: neonColorMap.green.border,
    fg: neonColorMap.green.text,
    icon: 'CheckCircle',
    dot: neonColorMap.green.dot,
  },
}

/** Normalize the wire-level severity values that may sneak into the frontend. */
export function normalizeSeverity(s: string | null | undefined): Severity {
  if (!s) return 'info'
  const v = s.toLowerCase()
  if (v === 'warning') return 'warn'
  if (v === 'error' || v === 'fatal') return 'critical'
  if (v === 'ok' || v === 'success') return 'success'
  if (v === 'info' || v === 'warn' || v === 'critical') return v as Severity
  return 'info'
}

// ── Gauge / bar tone tokens — one map for every semantic fill colour ──
//
// Before this existed, every gauge call site picked its own hex
// (`color="#10b981"`, `color="#f59e0b"`, `color={pct > 80 ? '#ef4444' : …}`),
// which meant (a) "good" was three different greens depending on the page and
// (b) the brand-coloured gauges stayed hard-blue on warm / light / custom
// themes because a hex literal cannot follow `--theme-primary`.
//
// `gaugeTone` is the single source of truth. Two families live in it:
//
//   - THEME tones (`primary`, `accent`) resolve through the CSS variables the
//     ThemeProvider rewrites, so a gauge that means "this vehicle's headline
//     number" re-tints with the active preset.
//   - STATUS tones (`success`…`neutral`) use mode-aware semantic roles. A
//     danger bar must read as danger on all 140 presets, so it cannot inherit
//     an arbitrary accent. They share the severity palette, independently of
//     the categorical chart-series policy.
//
// Callers with a legitimately caller-defined series colour (a chart legend
// swatch, a per-series bar) keep using the raw `color` escape hatch.

export type GaugeTone =
  | 'primary'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'purple'
  | 'neutral'

export const gaugeTone: Record<GaugeTone, string> = {
  /** The active theme's primary brand colour — follows warm/light/custom presets. */
  primary: 'var(--theme-primary)',
  /** The active theme's secondary accent — follows warm/light/custom presets. */
  accent: 'var(--theme-accent)',
  success: 'var(--semantic-success)',
  warning: 'var(--semantic-warning)',
  danger: 'var(--semantic-danger)',
  info: 'var(--semantic-info)',
  purple: 'var(--semantic-purple)',
  /** Theme-aware muted grey for "no signal" / de-emphasised readings. */
  neutral: 'var(--text-secondary)',
}

/** Default tone applied when a gauge names neither a tone nor a raw colour. */
export const DEFAULT_GAUGE_TONE: GaugeTone = 'primary'

/**
 * Resolve a gauge fill to a CSS colour string.
 *
 * Precedence is deliberate and pinned by tests: **an explicit `tone` always
 * wins over a raw `color`**. `color` is the legacy/escape-hatch input, so a
 * call site that has been migrated to a semantic tone cannot be silently
 * overridden by a stale `color` prop left behind next to it. When neither is
 * given the gauge falls back to {@link DEFAULT_GAUGE_TONE}.
 */
export function resolveGaugeColor(tone?: GaugeTone, color?: string): string {
  if (tone && tone in gaugeTone) return gaugeTone[tone]
  if (color) return color
  return gaugeTone[DEFAULT_GAUGE_TONE]
}

// ── Chart tokens — single source of truth for theme-aware chart styling ──
//
// Recharts components historically hardcode hex colors that look correct in
// dark mode but fail in light mode. `chartTokens` reads from CSS variables that
// invert via `:root.light-mode` overrides in `index.css`, so axis ticks, grid
// lines, and tooltip surfaces stay readable across themes.
//
// `series` is the deliberate, color-blind-safe palette used for multi-line
// charts; series colors stay constant across themes (the chart background and
// axes do the theming work).

export const chartTokens = {
  /** Stroke color for axis lines and ticks — theme-aware muted text. */
  axisStroke: 'var(--text-muted)',
  /** Stroke color for cartesian grid lines — theme-aware subtle border. */
  gridStroke: 'var(--border-subtle)',
  /** Background of Recharts tooltip card. */
  tooltipBg: 'var(--surface-elevated)',
  /** Border color of Recharts tooltip card. */
  tooltipBorder: 'var(--border-default)',
  /** Foreground / label text inside Recharts tooltip card. */
  tooltipText: 'var(--text-primary)',
  /** Secondary text color inside Recharts tooltip (label key, units). */
  tooltipMutedText: 'var(--text-secondary)',
  /**
   * Restrained series in the existing blue/green/amber/rose/purple/cyan/pink/
   * lime order. The existing root color-scheme selects the presentation pair.
   */
  series: ['light-dark(#385e7e, #91b4d2)', 'light-dark(#38614f, #91b9a5)', 'light-dark(#745829, #cfb481)', 'light-dark(#83464e, #d6a0a5)', 'light-dark(#625077, #b5a8c9)', 'light-dark(#3f6268, #91bbc0)', 'light-dark(#785568, #c3a2b5)', 'light-dark(#586437, #acba91)'] as const,
  /**
   * Brush widget styling — used by `<ChartBrush>` to keep zoom-selection bars
   * consistent across pages. The fill is intentionally near-transparent so the
   * underlying overview line stays visible.
   */
  brush: {
    stroke: 'var(--text-secondary)',
    fill: 'color-mix(in srgb, var(--text-secondary) 6%, transparent)',
    travellerWidth: 8,
    height: 28,
  },
  /**
   * Synced-cursor reference line — drawn by recharts when two charts share
   * the same `syncId`. We expose the styling here so any custom cursor lines
   * (added via `<ReferenceLine>`) render identically.
   */
  cursor: {
    stroke: 'var(--text-secondary)',
    strokeWidth: 1,
    strokeDasharray: '4 2',
  },
  /** Stable namespaced chart IDs used by `useChartLegendState` for localStorage keys.
   *  Add new entries here so the legend-toggle keys stay grep-able and collision-free. */
  ids: {
    driveOverview: 'drive-detail.overview',
    driveSoc: 'drive-detail.soc',
    driveElevation: 'drive-detail.elevation',
    drivePower: 'drive-detail.power',
    driveTemperature: 'drive-detail.temperature',
    driveSpeedHistogram: 'drive-detail.speed-histogram',
    chargingCurve: 'charging-detail.curve',
    chargingTimeSeries: 'charging-detail.soc-energy-range',
    chargingTemp: 'charging-detail.temperature',
    chargingVoltCurrent: 'charging-detail.voltage-current',
    batteryProjection: 'battery-degradation.projection',
    batteryRange: 'battery-degradation.range',
    sleepStateDistribution: 'sleep.state-distribution',
    sleepSentryComparison: 'sleep.sentry-comparison',
  },
} as const
