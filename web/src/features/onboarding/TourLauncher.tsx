import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, PlayCircle, RotateCcw, Sparkles, X } from 'lucide-react'

import { Modal, Button } from '@/components/ui'
import { EmptyState } from '@/components/feedback'
import { cn } from '@/lib/cn'
import {
  TOUR_OPEN_LAUNCHER_EVENT,
  TOUR_START_EVENT,
  type TourDefinition,
  dispatchTourStart,
  isRecommendedForRoute,
  isTourCompleted,
  listTours,
  markTourListSeen,
  resetAllTours,
} from '@/lib/tourRegistry'

/**
 * TourLauncher.
 *
 * Modal listing every tour in the registry. Opens in response to:
 *  - The {@link TOUR_OPEN_LAUNCHER_EVENT} CustomEvent (dispatched by the
 *    sidebar help button, the command palette command `tour.openLauncher`,
 *    and the Settings page tour card).
 *  - Direct controlled use via the `open` prop is intentionally not
 *    supported — keeping ownership of state inside this component avoids
 *    threading additional props through Layout for what is essentially a
 *    one-off modal.
 *
 * Each row exposes the tour title + one-line description, marks completed
 * tours with a check, and highlights the tour matching the current route as
 * "Recommended for this page". Starting a tour dispatches
 * {@link TOUR_START_EVENT} so Layout can promote it to active state.
 */
export function TourLauncher() {
  const { t } = useTranslation()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [, setVersionTick] = useState(0)

  // Listen for the global open event so any caller (palette, help button,
  // settings page) can pop the launcher without a ref.
  useEffect(() => {
    const handler = () => {
      setOpen(true)
      markTourListSeen()
    }
    window.addEventListener(TOUR_OPEN_LAUNCHER_EVENT, handler)
    return () => window.removeEventListener(TOUR_OPEN_LAUNCHER_EVENT, handler)
  }, [])

  // Force a re-render after a tour starts/finishes so the "Completed" badges
  // pick up the freshly-written localStorage state when the user re-opens
  // the launcher in the same session.
  useEffect(() => {
    const handler = () => setVersionTick((n) => n + 1)
    window.addEventListener(TOUR_START_EVENT, handler as EventListener)
    return () => window.removeEventListener(TOUR_START_EVENT, handler as EventListener)
  }, [])

  // The registry is static, so derive the ordered list once. Completion state
  // is read per-row via isTourCompleted() below, so re-renders triggered by
  // versionTick still pick up freshly-written localStorage flags.
  const tours = useMemo(() => listTours() ?? [], [])

  const handleStart = useCallback((def: TourDefinition) => {
    setOpen(false)
    // Defer the dispatch one tick so Layout's tour state machine sees the
    // event after the modal-close re-render settles. Without the timeout,
    // React batches the two state updates and the modal's portal can still
    // be in the DOM when the spotlight tries to query its target.
    window.setTimeout(() => dispatchTourStart(def.id), 0)
  }, [])

  const handleResetAll = useCallback(() => {
    resetAllTours()
    setVersionTick((n) => n + 1)
  }, [])

  const handleClose = useCallback(() => setOpen(false), [])

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('tour.launcher.title', 'Take a tour')}
      size="md"
    >
      <div className="space-y-3">
        <p className="text-xs text-[var(--text-muted)]">
          {t(
            'tour.launcher.subtitle',
            'Bite-sized walkthroughs of each area. Replay any tour anytime.',
          )}
        </p>

        {tours.length === 0 ? (
          <EmptyState /* no-action: listTours() reads the static TOURS registry (8 hardcoded tour definitions in tourRegistry.ts); there is no user action that adds or removes a tour from it. */
            message={t('tour.launcher.empty', 'No tours are available yet.')}
          />
        ) : (
        <ul className="space-y-2">
          {tours.map((def) => {
            const completed = isTourCompleted(def.id, def.version)
            const recommended = isRecommendedForRoute(def, location.pathname)
            return (
              <li
                key={def.id}
                className={cn(
                  'flex items-start gap-3 rounded-xl border p-3 transition-colors',
                  recommended
                    ? 'border-[var(--theme-primary)]/40 bg-[rgba(var(--theme-primary-rgb),0.06)]'
                    : 'border-[var(--glass-border)] bg-[var(--surface-1)]',
                )}
              >
                <div
                  className={cn(
                    'mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border',
                    completed
                      ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-300'
                      : 'border-[var(--border-subtle)] bg-white/[0.04] text-[var(--text-secondary)]',
                  )}
                  aria-hidden
                >
                  {completed ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <PlayCircle className="h-4 w-4" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                      {t(def.titleKey, def.titleFallback)}
                    </h3>
                    {recommended && (
                      <span
                        className="inline-flex items-center gap-1 rounded-md bg-[rgba(var(--theme-primary-rgb),0.12)] px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wider text-[var(--theme-primary)]"
                        title={t('tour.launcher.recommendedHere', 'Recommended for this page')}
                      >
                        <Sparkles className="h-3 w-3" aria-hidden />
                        {t('tour.launcher.recommendedHere', 'Recommended for this page')}
                      </span>
                    )}
                    {completed && (
                      <span className="rounded-md bg-emerald-300/10 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wider text-emerald-300">
                        {t('tour.launcher.completed', 'Completed')}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {t(def.descriptionKey, def.descriptionFallback)}
                  </p>
                </div>

                <Button
                  variant={recommended ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => handleStart(def)}
                  data-tour-launch={def.id}
                  aria-label={
                    completed
                      ? t('tour.launcher.replayAria', 'Replay tour: {{title}}', {
                          title: t(def.titleKey, def.titleFallback),
                        })
                      : t('tour.launcher.startAria', 'Start tour: {{title}}', {
                          title: t(def.titleKey, def.titleFallback),
                        })
                  }
                >
                  {completed
                    ? t('tour.launcher.replay', 'Replay')
                    : t('tour.launcher.start', 'Start')}
                </Button>
              </li>
            )
          })}
        </ul>
        )}

        <div className="flex items-center justify-between border-t border-[var(--glass-border)] pt-3">
          <button
            type="button"
            onClick={handleResetAll}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-primary)]"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {t('tour.launcher.resetAll', 'Reset all tours')}
          </button>
          <Button variant="ghost" size="sm" onClick={handleClose}>
            <X className="mr-1 h-3.5 w-3.5" aria-hidden />
            {t('tour.launcher.close', 'Close')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
