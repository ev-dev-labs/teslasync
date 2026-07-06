import { motion } from 'framer-motion'
import { useMemo, type ReactNode } from 'react'
import { useMotionPreference } from '@/hooks/useMotionPreference'

/** Seconds between each child's entrance when motion is enabled. */
const STAGGER_SECONDS = 0.06

/**
 * Container that staggers the entrance animation of its children. When the
 * user has requested reduced motion, the stagger is collapsed to a no-op so
 * children appear in their final state immediately.
 */
export function StaggerContainer({ children, className = '' }: { children: ReactNode; className?: string }) {
  const { reduce } = useMotionPreference()
  // Keep the variants object reference stable across unrelated parent
  // re-renders — it only changes when the reduced-motion preference flips.
  // framer-motion reads the variants reference internally, so a fresh literal
  // on every render would make it re-resolve the orchestration needlessly.
  const variants = useMemo(
    () => ({
      hidden: {},
      show: { transition: { staggerChildren: reduce ? 0 : STAGGER_SECONDS } },
    }),
    [reduce],
  )
  return (
    <motion.div initial="hidden" animate="show" variants={variants} className={className}>
      {children}
    </motion.div>
  )
}

