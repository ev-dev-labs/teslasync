import { motion } from 'framer-motion'
import { type ReactNode } from 'react'
import { useMotionPreference } from '@/hooks/useMotionPreference'

/**
 * Container that staggers the entrance animation of its children. When the
 * user has requested reduced motion, the stagger is collapsed to a no-op so
 * children appear in their final state immediately.
 */
export function StaggerContainer({ children, className = '' }: { children: ReactNode; className?: string }) {
  const { reduce } = useMotionPreference()
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: reduce ? 0 : 0.06 } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

