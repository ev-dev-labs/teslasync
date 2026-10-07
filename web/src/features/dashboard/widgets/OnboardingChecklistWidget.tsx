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
import { Badge, Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useVehicles } from '@/api/hooks/useVehicles'
import { useAlertRules, useNotificationChannels } from '@/api/hooks/useNotifications'
import { useDataState } from '@/hooks/useDataState'
import { combineDataStates, deriveDataState } from '@/api/dataState'
import { useNumberFormatting } from '@/hooks/useNumberFormatting'
import { severityTokens } from '@/lib/tokens'
import { dashboardTokens } from '../lib/dashboardTokens'

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
  const { fmtInt } = useNumberFormatting()

  const state = useChecklistTasks()
  // Observe the same cached queries: the checklist's boolean projection does
  // not expose transport state and must not turn a failed read into "not set up".
  const vehicles = useVehicles()
  const rules = useAlertRules()
  const channels = useNotificationChannels()
  const vehiclesState = useDataState(vehicles)
  const rulesState = useDataState(rules)
  const channelsState = useDataState(channels)
  const localState = deriveDataState({ data: state }, { provenance: 'inferred' })
  const retry = () => { void vehicles.refetch(); void rules.refetch(); void channels.refetch() }
  const dataState = {
    ...combineDataStates([localState, vehiclesState, rulesState, channelsState]),
    data: state,
    hasData: true,
    retry,
  }
  const taskSources = {
    'connect-vehicle': vehiclesState,
    'first-alert': rulesState,
    'notification-channel': channelsState,
  }
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
  const tasks = Array.isArray(visibleTasks) ? visibleTasks : []
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
  const icon = <Rocket className="h-3.5 w-3.5 text-[var(--text-secondary)]" />

  // ── Hidden / dismissed state — small footprint with restart affordance ──
  if (hidden) {
    return (
      <WidgetShell title={title} icon={icon} dataState={dataState}>
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
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={dismiss}
      className="min-h-11 min-w-11 text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
      aria-label={t('checklist.dismiss', 'Dismiss')}
      title={t('checklist.dismiss', 'Dismiss')}
    >
      <X className="h-3.5 w-3.5" />
    </Button>
  )

  return (
    <WidgetShell title={title} icon={icon} actions={headerActions} dataState={dataState}>
      <div className="flex flex-col h-full gap-4">
        {/* Progress header */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-medium text-[var(--text-primary)]">
              {t('checklist.progress', '{{done}}/{{total}} complete', {
                done: fmtInt(completed),
                total: fmtInt(total),
              })}
            </span>
            <span className="text-[var(--text-muted)] tabular-nums">{fmtInt(progressPct)}%</span>
          </div>
          <div
            className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"
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
                'bg-[var(--theme-primary)]',
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
              const source = taskSources[task.id as keyof typeof taskSources]
              const unknown = source != null && !source.hasData
              return (
                <li
                  key={task.id}
                  className={cn(
                    'flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] py-3 transition-colors',
                    task.complete
                      ? 'opacity-60'
                      : 'hover:bg-[var(--surface-2)]',
                  )}
                  data-testid={`checklist-task-${task.id}`}
                  data-complete={task.complete ? 'true' : 'false'}
                >
                  <span className="flex-shrink-0" aria-hidden="true">
                    {task.complete ? (
                      <CheckCircle2 className={cn('h-4 w-4', severityTokens.success.fg)} />
                    ) : (
                      <Circle className="h-4 w-4 text-[var(--text-muted)]" />
                    )}
                  </span>
                  <span className="flex-shrink-0 hidden @sm:inline-flex h-7 w-7 items-center justify-center text-[var(--text-secondary)]">
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        dashboardTokens.title,
                        task.complete ? 'text-[var(--text-secondary)] line-through' : 'text-[var(--text-primary)]',
                      )}
                    >
                      {t(task.titleKey, task.titleFallback)}
                    </p>
                    <p className={dashboardTokens.metricLabel}>
                      {t(task.descriptionKey, task.descriptionFallback)}
                    </p>
                  </div>
                  {unknown && <Badge variant="neutral">{t('common.unknown', 'Unknown')}</Badge>}
                  {!task.complete && (
                    <Button
                      variant="ghost"
                      size="sm"
                      wrapLabel
                      onClick={() => handleCta(task.ctaTo)}
                      className="min-h-11 flex-shrink-0 text-[var(--theme-primary)]"
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
          <div className={cn('flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3', severityTokens.success.bg, severityTokens.success.border)}>
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className={cn('h-4 w-4 flex-shrink-0', severityTokens.success.fg)} />
              <p className={dashboardTokens.title}>
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
