import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Rocket,
  CheckCircle2,
  Circle,
  ArrowRight,
  Sparkles,
  X,
  RotateCcw,
} from 'lucide-react'

import { EmptyState } from '@/components/feedback'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'

import {
  COMMAND_PALETTE_CTA,
  shouldHideChecklist,
  useChecklistTasks,
} from '@/features/onboarding/checklist'

import { WidgetShell } from './WidgetShell'
import type { WidgetProps } from './types'

/**
 * OnboardingChecklistWidget — first-run setup checklist surface
 * Lists the handful of configuration steps that meaningfully change how
 * useful TeslaSync is — connecting Tesla, picking a theme, creating an
 * alert rule, configuring a notification channel, discovering the command
 * palette, and enabling browser push. Each row auto-completes the moment
 * its underlying state flips (no manual marking needed).
 * Visibility:
 *   - Renders the full checklist while at least one task is incomplete.
 *   - Renders a celebratory "all set" state for 24h after 100 % complete
 *     (see CELEBRATION_WINDOW_MS in `@/features/onboarding/checklist`).
 *   - When the user explicitly dismisses the widget OR the celebration
 *     window has elapsed, renders a small "removed" state with a Restart
 *     affordance so the user can opt back in without leaving the page.
 *     Layout-level removal is the user's job from dashboard customize mode.
 */
export default function OnboardingChecklistWidget(_props: WidgetProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const state = useChecklistTasks()
  const {
    visibleTasks,
    completeCount,
    totalCount,
    allComplete,
    dismissed,
    completedAt,
    dismiss,
    restart,
  } = state

  // Null-safe views over the hook payload before we iterate / divide. The
  // hook is strongly typed, but guarding here keeps the widget robust if a
  // future refactor lets a field arrive undefined (house null-safety rule).
  const tasks = visibleTasks ?? []
  const completed = completeCount ?? 0
  const total = totalCount ?? 0

  const hidden = shouldHideChecklist({ dismissed, allComplete, completedAt })
  const progressPct = total === 0 ? 0 : Math.round((completed / total) * 100)

  const handleCta = useCallback(
    (ctaTo: string) => {
      if (ctaTo === COMMAND_PALETTE_CTA) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('toggle-command-palette'))
        }
        return
      }
      navigate(ctaTo)
    },
    [navigate],
  )

  const title = t('checklist.title', 'Get started')
  const icon = <Rocket className="h-3.5 w-3.5 text-cyan-300" />

  // ── Hidden / dismissed state — small footprint with restart affordance ──
  if (hidden) {
    return (
      <WidgetShell title={title} icon={icon}>
        <EmptyState
          icon={<Sparkles className="h-5 w-5" />}
          title={
            allComplete
              ? t('checklist.completeMessage', "You're all set! 🎉")
              : t('checklist.dismissedTitle', 'Setup checklist hidden')
          }
          message={t(
            'checklist.dismissedMessage',
            'Remove this widget from your dashboard or restart the checklist to see your remaining setup steps.',
          )}
          action={{
            label: t('checklist.restart', 'Restart checklist'),
            onClick: restart,
          }}
          className="py-4"
        />
      </WidgetShell>
    )
  }

  // ── Header actions: dismiss button (always visible while widget renders) ──
  const headerActions = (
    <button
      type="button"
      onClick={dismiss}
      className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-white/[0.06] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 transition-colors"
      aria-label={t('checklist.dismiss', 'Dismiss')}
      title={t('checklist.dismiss', 'Dismiss')}
    >
      <X className="h-3.5 w-3.5" />
    </button>
  )

  return (
    <WidgetShell title={title} icon={icon} actions={headerActions}>
      <div className="flex flex-col h-full gap-4">
        {/* Progress header */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-[var(--text-primary)]">
              {t('checklist.progress', '{{done}}/{{total}} complete', {
                done: completed,
                total,
              })}
            </span>
            <span className="text-[var(--text-muted)] tabular-nums">{progressPct}%</span>
          </div>
          <div
            className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={completed}
            aria-label={t('checklist.progress', '{{done}}/{{total}} complete', {
              done: completed,
              total,
            })}
          >
            <div
              className={cn(
                'h-full rounded-full transition-all duration-slow',
                allComplete
                  ? 'bg-gradient-to-r from-emerald-400 to-cyan-400'
                  : 'bg-gradient-to-r from-cyan-400 to-indigo-400',
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Task list */}
        {total === 0 ? (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<CheckCircle2 className="h-5 w-5" />}
            message={t('checklist.empty', 'No setup steps available right now.')}
            className="py-4"
          />
        ) : (
          <ul className="flex flex-col gap-2" data-testid="onboarding-checklist">
            {tasks.map((task) => {
              const Icon = task.icon
              return (
                <li
                  key={task.id}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 transition-colors',
                    task.complete
                      ? 'opacity-60'
                      : 'hover:border-[var(--border-subtle)] hover:bg-white/[0.04]',
                  )}
                  data-testid={`checklist-task-${task.id}`}
                  data-complete={task.complete ? 'true' : 'false'}
                >
                  <span className="flex-shrink-0" aria-hidden="true">
                    {task.complete ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                    ) : (
                      <Circle className="h-4 w-4 text-[var(--text-muted)]" />
                    )}
                  </span>
                  <span className="flex-shrink-0 hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.04] text-[var(--text-secondary)]">
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        'text-sm font-medium truncate',
                        task.complete ? 'text-[var(--text-secondary)] line-through' : 'text-[var(--text-primary)]',
                      )}
                    >
                      {t(task.titleKey, task.titleFallback)}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)] truncate">
                      {t(task.descriptionKey, task.descriptionFallback)}
                    </p>
                  </div>
                  {!task.complete && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCta(task.ctaTo)}
                      className="flex-shrink-0 text-cyan-300 hover:text-cyan-200"
                    >
                      {t(task.ctaKey, task.ctaFallback)}
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {/* Completion footer — celebrates 100 % and offers restart */}
        {allComplete && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-300/20 bg-emerald-300/[0.06] p-3">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="h-4 w-4 text-emerald-300 flex-shrink-0" />
              <p className="text-sm font-medium text-emerald-200 truncate">
                {t('checklist.completeMessage', "You're all set! 🎉")}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={dismiss}
              className="flex-shrink-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              icon={<RotateCcw className="h-3.5 w-3.5" />}
            >
              {t('checklist.dismiss', 'Dismiss')}
            </Button>
          </div>
        )}
      </div>
    </WidgetShell>
  )
}
