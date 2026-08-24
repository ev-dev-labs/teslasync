/**
 * Design tokens for TeslaSync UI component library.
 * Single source of truth for spacing, sizing, color mappings, and animation constants.
 */

// ── Neon color variants used across Badge, IconBox, Button, etc. ──

export type NeonColor = 'cyan' | 'green' | 'red' | 'purple' | 'amber' | 'blue'

// `text` uses Tailwind 300-level shades (toned-down) for readability — the saturated
// neon hues are reserved for backgrounds, borders, rings, glows, and single-glyph dots.
// `:root.light-mode` overrides in index.css invert these to dark variants on white.
export const neonColorMap: Record<NeonColor, {
  text: string
  bg: string
  ring: string
  border: string
  glow: string
  dot: string
}> = {
  cyan:   { text: 'text-cyan-300',    bg: 'bg-neon-cyan/10',   ring: 'ring-neon-cyan/20',   border: 'border-neon-cyan/30',   glow: 'shadow-[0_0_15px_rgba(0,240,255,0.1)]',     dot: 'bg-neon-cyan' },
  green:  { text: 'text-emerald-300', bg: 'bg-neon-green/10',  ring: 'ring-neon-green/20',  border: 'border-neon-green/30',  glow: 'shadow-[0_0_15px_rgba(16,185,129,0.1)]',    dot: 'bg-neon-green' },
  red:    { text: 'text-rose-300',    bg: 'bg-neon-red/10',    ring: 'ring-neon-red/20',    border: 'border-neon-red/30',    glow: 'shadow-[0_0_15px_rgba(239,68,68,0.1)]',     dot: 'bg-neon-red' },
  purple: { text: 'text-purple-300',  bg: 'bg-neon-purple/10', ring: 'ring-neon-purple/20', border: 'border-neon-purple/30', glow: 'shadow-[0_0_15px_rgba(168,85,247,0.1)]',    dot: 'bg-neon-purple' },
  amber:  { text: 'text-amber-300',   bg: 'bg-neon-amber/10',  ring: 'ring-neon-amber/20',  border: 'border-neon-amber/30',  glow: 'shadow-[0_0_15px_rgba(245,158,11,0.1)]',    dot: 'bg-neon-amber' },
  blue:   { text: 'text-indigo-300',  bg: 'bg-neon-blue/10',   ring: 'ring-neon-blue/20',   border: 'border-neon-blue/30',   glow: 'shadow-[0_0_15px_rgba(79,70,229,0.1)]',     dot: 'bg-neon-blue' },
}

// ── Semantic color aliases ──

export type SemanticColor = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export const semanticToNeon: Record<SemanticColor, NeonColor> = {
  success: 'green',
  warning: 'amber',
  danger: 'red',
  info: 'cyan',
  neutral: 'blue',
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
  sm: 'p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]',
  md: 'p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]',
  lg: 'p-5 rounded-xl bg-white/[0.02] border border-white/[0.06]',
} as const

// ── Table styling tokens ──
//
// Includes sticky-header, selection-row, bulk-bar, resizer-handle, and
// expanded-row tokens used by DataTable's optional features.

export const tableTokens = {
  wrapper: 'w-full text-sm',
  head: 'border-b border-white/[0.06] text-[var(--text-muted)] text-xs uppercase tracking-wider',
  headCell: 'px-4 py-3 text-left font-medium',
  body: 'divide-y divide-white/[0.03]',
  row: 'hover:bg-white/[0.02] transition-colors',
  cell: 'px-4 py-3',
  /** Wrapper applied when stickyHeader / maxHeight is in use — needs scroll + relative for sticky thead. */
  scrollContainer: 'relative overflow-auto rounded-xl',
  /** Applied to <thead> rows when stickyHeader is true. The bg matches GlassPanel
   *  surface so rows scrolling underneath don't bleed through. z-20 keeps the
   *  sticky thead above selected-row z-10 hover states. */
  stickyHead: 'sticky top-0 z-20 bg-[var(--surface-elevated)] backdrop-blur-sm',
  /** Visual treatment for selected rows. */
  rowSelected: 'bg-cyan-500/10 hover:bg-cyan-500/15',
  /** Container for the bulk-action toolbar that appears above the table. */
  bulkBar:
    'flex flex-wrap items-center gap-2 px-3 py-2 mb-2 rounded-lg ' +
    'border border-cyan-500/20 bg-cyan-500/[0.06] text-sm text-[var(--text-primary)]',
  /** Width of the leading checkbox/chevron columns. */
  leadingColWidth: 'w-10',
  /** The drag handle on the right edge of resizable column headers. */
  resizer:
    'absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none ' +
    'opacity-0 hover:opacity-100 hover:bg-cyan-400/40 transition-opacity ' +
    'focus-visible:opacity-100 focus-visible:bg-cyan-400/60 outline-none',
  /** Cell holding `renderExpanded` content under an expanded row. */
  expandedCell:
    'px-4 py-3 bg-white/[0.02] border-l-2 border-cyan-500/40',
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
    pageTitle: 'text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight text-[var(--text-primary)]',
    sectionTitle: 'text-lg font-semibold tracking-tight text-[var(--text-primary)]',
    panelTitle: 'text-base font-semibold text-[var(--text-primary)]',
    subhead: 'text-sm font-medium text-[var(--text-secondary)]',
    body: 'text-sm text-[var(--text-primary)]',
    bodySm: 'text-xs text-[var(--text-secondary)]',
    caption: 'text-xs text-[var(--text-muted)]',
    label: 'text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]',
    metricValue: 'text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)] tabular-nums',
    metricLabel: 'text-2xs font-medium uppercase tracking-wider text-[var(--text-muted)]',
    code: 'text-xs font-mono text-[var(--text-primary)]',
    helper: 'text-xs text-[var(--text-muted)]',
    error: 'text-xs text-rose-300',
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
    bg: 'bg-sky-500/10',
    border: 'border-sky-500/30',
    fg: 'text-sky-300',
    icon: 'Info',
    dot: 'bg-sky-400',
  },
  warn: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    fg: 'text-amber-300',
    icon: 'AlertTriangle',
    dot: 'bg-amber-400',
  },
  critical: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    fg: 'text-red-300',
    icon: 'AlertOctagon',
    dot: 'bg-red-400',
  },
  success: {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    fg: 'text-emerald-300',
    icon: 'CheckCircle',
    dot: 'bg-emerald-400',
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
//   - STATUS tones (`success`…`neutral`) are deliberately FIXED colours. A
//     danger bar must read as danger on all 140 presets, so it cannot inherit
//     an arbitrary accent. They are the same hues the chart series palette and
//     severity tokens use, chosen for contrast against both dark and light
//     surfaces.
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
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#0ea5e9',
  purple: '#8b5cf6',
  /** Theme-aware muted grey for "no signal" / de-emphasised readings. */
  neutral: 'var(--text-muted)',
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
   * Series palette for multi-line/area charts. Color-blind safe (Okabe-Ito-
   * inspired) and identical across themes — chart series should "pop" against
   * either light or dark backgrounds.
   */
  series: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'] as const,
  /**
   * Brush widget styling — used by `<ChartBrush>` to keep zoom-selection bars
   * consistent across pages. The fill is intentionally near-transparent so the
   * underlying overview line stays visible.
   */
  brush: {
    stroke: '#22d3ee',
    fill: 'rgba(255, 255, 255, 0.03)',
    travellerWidth: 8,
    height: 28,
  },
  /**
   * Synced-cursor reference line — drawn by recharts when two charts share
   * the same `syncId`. We expose the styling here so any custom cursor lines
   * (added via `<ReferenceLine>`) render identically.
   */
  cursor: {
    stroke: 'rgba(255, 255, 255, 0.3)',
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
