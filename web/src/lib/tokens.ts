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

export const tableTokens = {
  wrapper: 'w-full text-sm',
  head: 'border-b border-white/[0.06] text-[var(--text-muted)] text-xs uppercase tracking-wider',
  headCell: 'px-4 py-3 text-left font-medium',
  body: 'divide-y divide-white/[0.03]',
  row: 'hover:bg-white/[0.02] transition-colors',
  cell: 'px-4 py-3',
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
    subtle: 'text-white/60 dark:text-white/60',
    disabled: 'text-white/40',
    inverse: 'text-black/90 dark:text-white/90',
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
