import { motion } from 'framer-motion'
import { type ReactNode } from 'react'
import { useMotionPreference } from '@/hooks/useMotionPreference'

/**
 * Child item inside a StaggerContainer — animates in sequence. Respects
 * `prefers-reduced-motion`: when set, items render in their final state with
 * no slide-up.
 */
export function StaggerItem({ children, className = '' }: { children: ReactNode; className?: string }) {
  const { reduce, durationMs } = useMotionPreference(350)
  return (
    <motion.div
      variants={{
        hidden: reduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 15 },
        show: { opacity: 1, y: 0, transition: { duration: durationMs / 1000 } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
