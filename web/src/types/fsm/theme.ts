import type { BadgeVariant, StateStyle, StateEntry, ResolvedStateStyle } from './types'

/**
 * Single source of truth: BadgeVariant → Tailwind classes.
 * Change a color here → every FSM state with that variant updates.
 */
export const VARIANT_THEME: Record<BadgeVariant, StateStyle> = {
  success: {
    badgeDot: 'bg-green-400',
    bg:       'bg-green-500/10',
    text:     'text-green-400',
    dot:      'bg-green-400',
  },
  warning: {
    badgeDot: 'bg-amber-400',
    bg:       'bg-amber-500/10',
    text:     'text-amber-400',
    dot:      'bg-amber-400',
  },
  danger: {
    badgeDot: 'bg-red-400',
    bg:       'bg-red-500/10',
    text:     'text-red-400',
    dot:      'bg-red-400',
  },
  info: {
    badgeDot: 'bg-blue-400',
    bg:       'bg-blue-500/10',
    text:     'text-blue-400',
    dot:      'bg-blue-400',
  },
  neutral: {
    badgeDot: 'bg-gray-400',
    bg:       'bg-gray-500/10',
    text:     'text-[var(--text-muted)]',
    dot:      'bg-gray-400',
  },
}

/** Resolve a StateEntry to its full visual style (theme + overrides) */
export function resolveStyle(entry: StateEntry): ResolvedStateStyle {
  // Fall back to the neutral theme when the variant isn't in VARIANT_THEME.
  // Runtime data (API/registry state definitions) can carry an unexpected
  // variant string; without this guard `base` would be `undefined`, spreading
  // to nothing and leaving badgeDot/bg/text/dot unset — an unstyled badge.
  // Neutral keeps every class key populated while the original variant tag is
  // preserved below for debugging.
  const base = VARIANT_THEME[entry.variant] ?? VARIANT_THEME.neutral
  return {
    variant: entry.variant,
    ...base,
    ...entry.overrides,
  }
}

/** Default style for unknown states */
export const DEFAULT_STATE: ResolvedStateStyle = {
  variant: 'neutral',
  ...VARIANT_THEME.neutral,
}
