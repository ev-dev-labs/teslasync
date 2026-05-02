import { motion } from 'framer-motion'
import { type ReactNode } from 'react'
import { useMotionPreference } from '@/hooks/useMotionPreference'

/**
 * Fades in children with a slide-up animation. Optional delay for stagger
 * orchestration. Honors `prefers-reduced-motion` via `useMotionPreference`:
 * when reduced motion is requested, the element renders in its final state
 * with no entry animation.
 */
export function FadeIn({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const { reduce, durationMs } = useMotionPreference(400)
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: durationMs / 1000, delay: reduce ? 0 : delay, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
