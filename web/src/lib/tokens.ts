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
