import { useReducedMotion as useFramerReducedMotion } from 'framer-motion'

/**
 * Project wrapper around framer-motion's `useReducedMotion()`.
 *
 * Returns the user's reduced-motion preference plus a derived duration value
 * components can pass straight into `transition={{ duration: durationMs / 1000 }}`.
 *
 * - `reduce` is `true` when the OS reports `prefers-reduced-motion: reduce`,
 *   `false` otherwise. framer-motion may also return `null` while it figures
 *   out the value on first paint — we coalesce that to `false` so consumers
 *   never have to handle the tri-state.
 * - `durationMs` is `0` when reduced motion is requested, `defaultMs` (default
 *   `250`) otherwise. Pass `defaultMs` to override per-component.
 *
 * Usage:
 * ```tsx
 * const { reduce, durationMs } = useMotionPreference()
 * <motion.div
 *   initial={reduce ? false : { opacity: 0, y: 12 }}
 *   animate={{ opacity: 1, y: 0 }}
 *   transition={{ duration: durationMs / 1000, ease: 'easeOut' }}
 * />
 * ```
 *
 * Setting `initial={false}` tells framer-motion to skip the entry animation
 * entirely (the element renders in its `animate` state immediately) — this
 * is the recommended pattern when reduced motion is requested.
 *
 * See `docs/A11Y_GUIDELINES.md` for the project policy.
 */
export interface MotionPreference {
  /** True when the user has requested reduced motion. */
  reduce: boolean
  /** Recommended transition duration in milliseconds (0 when reduced). */
  durationMs: number
}

export function useMotionPreference(defaultMs = 250): MotionPreference {
  const reduce = useFramerReducedMotion() ?? false
  return { reduce, durationMs: reduce ? 0 : defaultMs }
}
