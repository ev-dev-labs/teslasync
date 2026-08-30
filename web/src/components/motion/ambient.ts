/**
 * Ambient-motion helpers (A11Y-08).
 *
 * `useMotionPreference()` is the right tool when a component owns one
 * or two animations. It is the wrong tool for a decorative scene like
 * `<VehicleTwin>`, which paints ~17 independently looping SVG layers
 * across a dozen leaf components: adding a hook call to every leaf
 * multiplies the surface where a future contributor forgets one, and a
 * single forgotten `repeat: Infinity` is exactly the failure this rule
 * exists to prevent (WCAG 2.2.2 — an animation that loops for more than
 * five seconds must be stoppable).
 *
 * These helpers are pure functions, so they can be applied at every
 * `motion.*` element without threading a hook (or a context) through
 * the scene:
 *
 * ```tsx
 * <motion.ellipse
 *   animate={ambientFrames({ opacity: [0.2, 0.55, 0.2] })}
 *   transition={ambientLoop({ duration: 2.4, repeat: Infinity })}
 * />
 * ```
 *
 * Reactivity contract
 * -------------------
 * Reading `matchMedia` at render time means a mid-session change of the
 * OS preference is only picked up on the NEXT render. That is fine for
 * ambient decoration, and the root component of any scene using these
 * helpers is expected to call `useMotionPreference()` once — the hook
 * subscribes to the media query, so a preference flip re-renders the
 * whole subtree and every helper below re-evaluates. `<VehicleTwin>`
 * does exactly that.
 *
 * Use `useMotionPreference()` directly for one-off animations; reach
 * for these only inside a scene with many looping layers.
 */

import type { Transition, TargetAndTransition } from 'framer-motion';

/**
 * Synchronous read of the OS reduced-motion preference.
 *
 * Returns `false` when `matchMedia` is unavailable (SSR, jsdom without
 * a stub) so animation is the default and nothing crashes.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/**
 * Collapse a transition to an instant, non-repeating one when the user
 * has asked for reduced motion.
 *
 * `repeat: 0` is set explicitly rather than merely zeroing the duration:
 * a zero-duration infinite repeat still schedules a callback on every
 * frame, which keeps the main thread busy and drains battery even
 * though nothing visibly moves.
 */
export function ambientLoop(transition: Transition): Transition {
  if (!prefersReducedMotion()) return transition;
  return { duration: 0, repeat: 0, delay: 0 };
}

/**
 * Collapse keyframe arrays in an animation target to their resting
 * frame.
 *
 * Ambient loops in this codebase are written as `[rest, peak, rest]`,
 * so the FIRST entry is the value the element should hold when motion
 * is suppressed. Taking the last entry would be equivalent for a
 * well-formed loop but wrong for a one-way ramp, and taking the peak
 * would leave every decorative glow stuck at full brightness.
 *
 * Non-array values pass through untouched, so a mixed target
 * (`{ opacity: [0.2, 0.55, 0.2], scale: 1 }`) is safe.
 */
export function ambientFrames(
  target: TargetAndTransition,
): TargetAndTransition {
  if (!prefersReducedMotion()) return target;
  const settled: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(target)) {
    settled[key] = Array.isArray(value) && value.length > 0 ? value[0] : value;
  }
  return settled as TargetAndTransition;
}
