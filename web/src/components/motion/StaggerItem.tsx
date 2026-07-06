import { motion, type Variants } from 'framer-motion'
import { type ReactNode, useMemo } from 'react'
import { useMotionPreference } from '@/hooks/useMotionPreference'

/**
 * Child item inside a StaggerContainer — animates in sequence. Respects
 * `prefers-reduced-motion`: when set, items render in their final state with
 * no slide-up.
 *
 * The animation is driven entirely by variants inherited from the parent
 * `StaggerContainer` (`initial="hidden"` → `animate="show"`), so this
 * component intentionally sets no `initial`/`animate` of its own.
 */
export function StaggerItem({ children, className = '' }: { children: ReactNode; className?: string }) {
  const { reduce, durationMs } = useMotionPreference(350)
  // Memoise so the variants object identity is stable across re-renders and
  // only changes when the reduced-motion preference / duration actually does.
  const variants = useMemo<Variants>(
    () => ({
      hidden: reduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 15 },
      show: { opacity: 1, y: 0, transition: { duration: durationMs / 1000 } },
    }),
    [reduce, durationMs],
  )
  return (
    <motion.div variants={variants} className={className}>
      {children}
    </motion.div>
  )
}
