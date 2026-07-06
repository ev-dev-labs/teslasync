import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { COLOR } from '@/lib/colors'
import { useMotionPreference } from '@/hooks/useMotionPreference'

/**
 * Animated Tesla silhouette SVG for loading states and hero sections.
 * Honors `prefers-reduced-motion`: when reduced motion is requested, the SVG
 * renders in its final state with no entry animation, draw-in, or pulsing
 * head/tail-light loop.
 */
export function CarAnimation({ size = 120, className = '' }: { size?: number; className?: string }) {
  const w = size
  const h = size * 0.4
  const { reduce } = useMotionPreference()
  const { t } = useTranslation()

  return (
    <div className={`inline-flex items-center justify-center ${className}`} role="img" aria-label={t('carAnimation.tesla', 'Tesla vehicle illustration')}>
      <svg width={w} height={h} viewBox="0 0 240 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Car body */}
        <motion.path
          d="M30 60 Q30 40 50 35 L80 28 Q100 20 130 20 Q160 20 180 28 L210 35 Q230 40 230 60 L230 65 Q230 70 225 70 L35 70 Q30 70 30 65 Z"
          fill="var(--surface-2)"
          stroke="var(--theme-primary)"
          strokeWidth="1.5"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: reduce ? 0 : 1.5, ease: 'easeInOut' }}
        />
        {/* Windshield */}
        <motion.path
          d="M85 30 Q100 22 130 22 Q155 22 170 28 L155 42 Q140 44 120 44 Q100 44 90 42 Z"
          fill="var(--theme-primary)"
          fillOpacity={0.15}
          stroke="var(--theme-primary)"
          strokeWidth="0.8"
          strokeOpacity={0.5}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: reduce ? 0 : 0.8, duration: reduce ? 0 : 0.6 }}
        />
        {/* Rear window */}
        <motion.path
          d="M55 38 L82 30 L88 42 Q78 44 68 42 Z"
          fill="var(--theme-primary)"
          fillOpacity={0.1}
          stroke="var(--theme-primary)"
          strokeWidth="0.6"
          strokeOpacity={0.3}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: reduce ? 0 : 1, duration: reduce ? 0 : 0.5 }}
        />
        {/* Front wheel */}
        <motion.circle cx="70" cy="70" r="14" fill="var(--surface-3)" stroke="var(--text-muted)" strokeWidth="2"
          initial={reduce ? false : { scale: 0 }} animate={{ scale: 1 }} transition={reduce ? { duration: 0 } : { delay: 0.3, type: 'spring' }} />
        <motion.circle cx="70" cy="70" r="6" fill="var(--surface-1)" stroke="var(--text-muted)" strokeWidth="1"
          initial={reduce ? false : { scale: 0 }} animate={{ scale: 1 }} transition={reduce ? { duration: 0 } : { delay: 0.5, type: 'spring' }} />
        {/* Rear wheel */}
        <motion.circle cx="190" cy="70" r="14" fill="var(--surface-3)" stroke="var(--text-muted)" strokeWidth="2"
          initial={reduce ? false : { scale: 0 }} animate={{ scale: 1 }} transition={reduce ? { duration: 0 } : { delay: 0.4, type: 'spring' }} />
        <motion.circle cx="190" cy="70" r="6" fill="var(--surface-1)" stroke="var(--text-muted)" strokeWidth="1"
          initial={reduce ? false : { scale: 0 }} animate={{ scale: 1 }} transition={reduce ? { duration: 0 } : { delay: 0.6, type: 'spring' }} />
        {/* Headlight glow */}
        <motion.ellipse cx="228" cy="55" rx="4" ry="6"
          fill="var(--theme-primary)" fillOpacity={0.8}
          initial={reduce ? false : { opacity: 0 }}
          animate={reduce ? { opacity: 0.8 } : { opacity: [0, 0.8, 0.4, 0.8] }}
          transition={reduce ? { duration: 0 } : { delay: 1.2, duration: 2, repeat: Infinity }}
        />
        {/* Taillight */}
        <motion.rect x="28" y="50" width="4" height="12" rx="2"
          fill="#ef4444" fillOpacity={0.7}
          initial={reduce ? false : { opacity: 0 }}
          animate={reduce ? { opacity: 0.7 } : { opacity: [0, 0.7, 0.3, 0.7] }}
          transition={reduce ? { duration: 0 } : { delay: 1.4, duration: 2, repeat: Infinity }}
        />
        {/* Ground shadow */}
        <motion.ellipse cx="130" cy="86" rx="90" ry="4"
          fill="var(--text-muted)" fillOpacity={0.15}
          initial={reduce ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={reduce ? { duration: 0 } : { delay: 0.5, duration: 0.8 }}
        />
      </svg>
    </div>
  )
}

/**
 * Animated charging bolt icon for charging-related pages. Pulse animation is
 * disabled when the user has requested reduced motion.
 */
export function ChargingBolt({ size = 32, className = '' }: { size?: number; className?: string }) {
  const { reduce } = useMotionPreference()
  const { t } = useTranslation()
  return (
    <motion.svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      className={className}
      role="img"
      aria-label={t('carAnimation.charging', 'Charging')}
      initial={reduce ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.5 }}
    >
      <motion.path
        d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
        fill="var(--theme-primary)"
        fillOpacity={0.2}
        stroke="var(--theme-primary)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        animate={reduce ? { fillOpacity: 0.2 } : { fillOpacity: [0.1, 0.3, 0.1] }}
        transition={reduce ? { duration: 0 } : { duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
      />
    </motion.svg>
  )
}

/**
 * Inner drawable width of the battery body in the fixed `0 0 48 24` viewBox.
 * The gauge fill is expressed in viewBox units (0 = empty, 38 = full) so it
 * stays correct regardless of the rendered `size`, which only scales the
 * outer <svg>.
 */
const BATTERY_FILL_MAX = 38

/**
 * Animated battery fill gauge. The fill animation respects reduced-motion
 * by jumping straight to the target width.
 */
export function BatteryFillAnimation({ level = 80, size = 48, className = '' }: { level?: number; size?: number; className?: string }) {
  // Clamp to a finite 0–100% so an out-of-range, negative, or NaN level can
  // never produce a negative or overflowing SVG rect width.
  const clampedLevel = Math.max(0, Math.min(Number.isFinite(level) ? level : 0, 100))
  // Fill width lives in the fixed viewBox, derived from the clamped percentage
  // only — never from `size` (which merely scales the rendered <svg>). Scaling
  // it by `size` made the gauge under-fill at every size other than 48.
  const fillWidth = (BATTERY_FILL_MAX * clampedLevel) / 100
  const color = clampedLevel >= 60 ? COLOR.GOOD : clampedLevel >= 30 ? COLOR.WARN : COLOR.BAD
  const { reduce } = useMotionPreference()
  const { t } = useTranslation()

  return (
    <motion.svg width={size} height={size * 0.5} viewBox="0 0 48 24" className={className}
      role="img"
      aria-label={t('carAnimation.battery', 'Battery at {{level}} percent', { level: Math.round(clampedLevel) })}
      initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduce ? 0 : 0.4 }}>
      {/* Battery outline */}
      <rect x="2" y="4" width="38" height="16" rx="3" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" />
      <rect x="40" y="8" width="4" height="8" rx="1" fill="var(--text-muted)" fillOpacity={0.4} />
      {/* Battery fill */}
      <motion.rect x="4" y="6" width={fillWidth} height="12" rx="1.5"
        fill={color}
        initial={reduce ? false : { width: 0 }}
        animate={{ width: fillWidth }}
        transition={reduce ? { duration: 0 } : { duration: 1.2, ease: 'easeOut', delay: 0.3 }}
      />
    </motion.svg>
  )
}

/** Evenly-spaced spoke angles (degrees) for the WheelSpin hub — hoisted so the
 * array is allocated once at module load instead of on every render. */
const WHEEL_SPOKE_ANGLES = [0, 72, 144, 216, 288] as const

/**
 * Spinning wheel animation for drive-related loading states. The continuous
 * spin is replaced with a static wheel when reduced motion is requested.
 */
export function WheelSpin({ size = 24, className = '' }: { size?: number; className?: string }) {
  const { reduce } = useMotionPreference()
  const { t } = useTranslation()
  return (
    <motion.svg width={size} height={size} viewBox="0 0 24 24" className={className} role="img" aria-label={t('carAnimation.loading', 'Loading')}>
      <circle cx="12" cy="12" r="10" fill="var(--surface-3)" stroke="var(--text-muted)" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="4" fill="var(--surface-1)" stroke="var(--text-muted)" strokeWidth="1" />
      <motion.g
        animate={reduce ? { rotate: 0 } : { rotate: 360 }}
        transition={reduce ? { duration: 0 } : { duration: 2, repeat: Infinity, ease: 'linear' }}
      >
        {WHEEL_SPOKE_ANGLES.map(angle => (
          <line
            key={angle}
            x1="12" y1="5" x2="12" y2="8"
            stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round"
            transform={`rotate(${angle} 12 12)`}
          />
        ))}
      </motion.g>
    </motion.svg>
  )
}
