import { useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { X, Trophy } from 'lucide-react'

import { AchievementBadge } from '@/features/analytics/components/AchievementBadge'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import type { AchievementUnlockedEvent } from '@/api/hooks/useAchievementUnlocks'
import { cn } from '@/lib/cn'

/**
 * AchievementUnlockedToast — a wider-than-normal toast that celebrates a
 * locked → unlocked transition.
 *
 * Layout:
 *   [ AchievementBadge size="md" ] [ name + description + View link ] [ × ]
 *
 * Motion:
 *   - Spring entry from the right (matches the standard `<Toast>`).
 *   - Confetti burst (~2.5s) of the achievement's emoji icon, spawned from the
 *     centre of the badge with randomised velocities.
 *   - Honours `prefers-reduced-motion: reduce`: no confetti, no scale tween,
 *     just a fade-in and a 6s lifetime.
 *
 * Accessibility:
 *   - role="status" + aria-live="polite" so screen-readers announce the
 *     unlock without interrupting the user (it's celebratory, not critical).
 *   - The "View" affordance is a real `<button>` so keyboard navigation works
 *     and clicks bubble through to the React Router programmatic navigate.
 *   - The dismiss `<button>` carries an `aria-label` and reuses the same
 *     focus-ring treatment as the standard `<Toast>` × button.
 */
export interface AchievementUnlockedToastProps {
  event: AchievementUnlockedEvent
  /** Called when the user dismisses the toast or auto-dismiss elapses. */
  onDismiss: () => void
  /** Auto-dismiss delay in milliseconds. Defaults to 6000. */
  durationMs?: number
}

interface ConfettiParticle {
  id: number
  // initial velocity components in pixels (final position = vx, vy)
  vx: number
  vy: number
  rotate: number
  delaySec: number
}

const CONFETTI_COUNT = 24
const CONFETTI_DURATION_SEC = 2.5

function buildConfettiParticles(): ConfettiParticle[] {
  // Deterministic PRNG would be overkill — confetti spread is purely visual.
  return Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
    id: i,
    vx: (Math.random() - 0.5) * 280,
    vy: -(Math.random() * 160 + 60),
    rotate: (Math.random() - 0.5) * 720,
    delaySec: Math.random() * 0.25,
  }))
}

export function AchievementUnlockedToast({
  event,
  onDismiss,
  durationMs = 6000,
}: AchievementUnlockedToastProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { reduce } = useMotionPreference()

  // One stable particle set per mount; new toasts get a fresh set.
  const particles = useMemo<ConfettiParticle[]>(
    () => (reduce ? [] : buildConfettiParticles()),
    [reduce],
  )

  // Auto-dismiss timer.
  const timerRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    timerRef.current = window.setTimeout(() => {
      onDismiss()
    }, durationMs)
    return () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    }
  }, [durationMs, onDismiss])

  function handleView() {
    onDismiss()
    navigate(`/lifetime?achievement=${encodeURIComponent(event.achievement.id)}`)
  }

  return (
    <motion.div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="achievement-unlocked-toast"
      layout
      initial={reduce ? false : { opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: 80, scale: 0.95 }}
      transition={reduce ? { duration: 0 } : { type: 'spring', bounce: 0.25, duration: 0.45 }}
      className={cn(
        'pointer-events-auto rounded-xl border backdrop-blur-xl p-4 bg-white/[0.03]',
        'border-yellow-500/40 shadow-[0_0_24px_rgba(234,179,8,0.18)]',
        'relative overflow-visible',
      )}
      style={{ width: 'min(360px, calc(100vw - 2rem))' }}
    >
      {/* Confetti overlay — particles emitted from the badge centre. */}
      {particles.length > 0 && (
        <div
          className="pointer-events-none absolute left-12 top-12 z-10"
          aria-hidden="true"
        >
          {particles.map(p => (
            <motion.span
              key={p.id}
              className="absolute select-none text-base"
              initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
              animate={{ x: p.vx, y: p.vy, opacity: 0, rotate: p.rotate }}
              transition={{
                duration: CONFETTI_DURATION_SEC,
                delay: p.delaySec,
                ease: [0.16, 0.84, 0.44, 1],
              }}
            >
              {event.achievement.icon || '🎉'}
            </motion.span>
          ))}
        </div>
      )}

      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          <AchievementBadge achievement={event.achievement} size="md" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Trophy className="h-3.5 w-3.5 text-yellow-300" aria-hidden="true" />
            <p className="text-2xs font-semibold uppercase tracking-wider text-yellow-300/90">
              {t('achievements.toastEyebrow', 'Achievement Unlocked')}
            </p>
          </div>
          <p className="mt-1 text-sm font-semibold text-[var(--text-primary)] leading-tight">
            {event.achievement.name}
          </p>
          <p className="mt-1 text-xs text-[var(--text-secondary)] line-clamp-2">
            {event.achievement.description}
          </p>
          <button
            type="button"
            onClick={handleView}
            className={cn(
              'mt-2 inline-flex items-center gap-1 text-xs font-medium text-yellow-300',
              'underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2',
              'focus-visible:ring-yellow-500/50 rounded',
            )}
          >
            {t('achievements.view', 'View')} →
          </button>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('achievements.dismiss', 'Dismiss achievement notification')}
          className="flex-shrink-0 rounded-lg p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/[0.05] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </motion.div>
  )
}

/**
 * AchievementUnlockedToastStack — fixed-position container that renders one
 * `AchievementUnlockedToast` per pending event, stacked vertically. Mounted
 * once at the app root by `AchievementUnlockListener`.
 *
 * Sits in its own corner (top-right) so achievement toasts don't compete with
 * the standard mutation-feedback `<Toast>` stack (bottom-right).
 */
export function AchievementUnlockedToastStack({
  events,
  onDismiss,
}: {
  events: AchievementUnlockedEvent[]
  onDismiss: (achievementId: string) => void
}) {
  return (
    <div
      className="fixed top-4 right-4 sm:top-6 sm:right-6 z-[110] flex flex-col gap-3 pointer-events-none safe-bottom"
      data-print-hide
    >
      <AnimatePresence mode="popLayout">
        {events.map(e => (
          <AchievementUnlockedToast
            key={e.achievement.id}
            event={e}
            onDismiss={() => onDismiss(e.achievement.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  )
}
