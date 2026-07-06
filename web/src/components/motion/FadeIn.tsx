import { motion } from 'framer-motion'
import { type ReactNode } from 'react'
import { useMotionPreference } from '@/hooks/useMotionPreference'

export interface FadeInProps {
  children: ReactNode
  /**
   * Seconds to wait before the entry animation starts — used to orchestrate
   * staggered reveals. Non-finite (`NaN`/`Infinity`) or negative values are
   * coerced to `0`, and the delay is ignored entirely when reduced motion is
   * requested.
   */
  delay?: number
  className?: string
}

/**
 * Fades in children with a slide-up animation. Optional delay for stagger
 * orchestration. Honors `prefers-reduced-motion` via `useMotionPreference`:
 * when reduced motion is requested, the element renders in its final state
 * with no entry animation.
 */
export function FadeIn({ children, delay = 0, className = '' }: FadeInProps) {
  const { reduce, durationMs } = useMotionPreference(400)
  // framer-motion never resolves a transition with a non-finite delay, which
  // would strand `children` at the initial `opacity: 0` (invisible). Coerce a
  // bad computed delay to 0, and skip it altogether under reduced motion.
  const safeDelay = reduce || !Number.isFinite(delay) ? 0 : Math.max(0, delay)
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: durationMs / 1000, delay: safeDelay, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
