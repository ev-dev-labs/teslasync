// Native parity port of the colour maps used by the data-display components,
// ported from web/src/lib/tokens.ts. Tailwind class tokens become resolved
// hex/rgba values so React Native styles can consume them directly. Only the
// subset consumed by this barrel (severity + neon + semantic) is ported.

/** Canonical severity union. Ported from web tokens. */
export type Severity = 'info' | 'warn' | 'critical' | 'success';

export interface SeverityColors {
  /** Foreground icon/small-label colour (Tailwind 300 shade). */
  fg: string;
  /** Inline status dot colour (Tailwind 400 shade). */
  dot: string;
  /** Soft background tint (Tailwind 500 @ 10%). */
  bg: string;
  /** Border colour (Tailwind 500 @ 30%). */
  border: string;
}

/** Ported from web severityTokens (Tailwind classes → resolved colours). */
export const severityColors: Record<Severity, SeverityColors> = {
  info: {
    fg: '#7dd3fc',
    dot: '#38bdf8',
    bg: 'rgba(14, 165, 233, 0.1)',
    border: 'rgba(14, 165, 233, 0.3)',
  },
  warn: {
    fg: '#fcd34d',
    dot: '#fbbf24',
    bg: 'rgba(245, 158, 11, 0.1)',
    border: 'rgba(245, 158, 11, 0.3)',
  },
  critical: {
    fg: '#fca5a5',
    dot: '#f87171',
    bg: 'rgba(239, 68, 68, 0.1)',
    border: 'rgba(239, 68, 68, 0.3)',
  },
  success: {
    fg: '#6ee7b7',
    dot: '#34d399',
    bg: 'rgba(16, 185, 129, 0.1)',
    border: 'rgba(16, 185, 129, 0.3)',
  },
};

/** Normalize wire-level severity values. Ported verbatim from web tokens. */
export function normalizeSeverity(s: string | null | undefined): Severity {
  if (!s) return 'info';
  const v = s.toLowerCase();
  if (v === 'warning') return 'warn';
  if (v === 'error' || v === 'fatal') return 'critical';
  if (v === 'ok' || v === 'success') return 'success';
  if (v === 'info' || v === 'warn' || v === 'critical') return v as Severity;
  return 'info';
}

/** Neon colour variants. Ported from web tokens NeonColor. */
export type NeonColor = 'cyan' | 'green' | 'red' | 'purple' | 'amber' | 'blue';

export interface NeonColors {
  /** Toned-down text colour (Tailwind 300 shade). */
  text: string;
  /** Saturated single-glyph dot colour. */
  dot: string;
  /** Soft background tint (@ 10%). */
  bg: string;
  /** Ring colour (@ 20%). */
  ring: string;
  /** Border colour (@ 30%). */
  border: string;
}

/** Ported from web neonColorMap (Tailwind classes → resolved colours). */
export const neonColors: Record<NeonColor, NeonColors> = {
  cyan: {
    text: '#67e8f9',
    dot: '#00f0ff',
    bg: 'rgba(0, 240, 255, 0.1)',
    ring: 'rgba(0, 240, 255, 0.2)',
    border: 'rgba(0, 240, 255, 0.3)',
  },
  green: {
    text: '#6ee7b7',
    dot: '#10b981',
    bg: 'rgba(16, 185, 129, 0.1)',
    ring: 'rgba(16, 185, 129, 0.2)',
    border: 'rgba(16, 185, 129, 0.3)',
  },
  red: {
    text: '#fda4af',
    dot: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.1)',
    ring: 'rgba(239, 68, 68, 0.2)',
    border: 'rgba(239, 68, 68, 0.3)',
  },
  purple: {
    text: '#d8b4fe',
    dot: '#a855f7',
    bg: 'rgba(168, 85, 247, 0.1)',
    ring: 'rgba(168, 85, 247, 0.2)',
    border: 'rgba(168, 85, 247, 0.3)',
  },
  amber: {
    text: '#fcd34d',
    dot: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.1)',
    ring: 'rgba(245, 158, 11, 0.2)',
    border: 'rgba(245, 158, 11, 0.3)',
  },
  blue: {
    text: '#a5b4fc',
    dot: '#4f46e5',
    bg: 'rgba(79, 70, 229, 0.1)',
    ring: 'rgba(79, 70, 229, 0.2)',
    border: 'rgba(79, 70, 229, 0.3)',
  },
};

/** Semantic colour aliases. Ported from web tokens. */
export type SemanticColor = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** Ported verbatim from web semanticToNeon. */
export const semanticToNeon: Record<SemanticColor, NeonColor> = {
  success: 'green',
  warning: 'amber',
  danger: 'red',
  info: 'cyan',
  neutral: 'blue',
};
