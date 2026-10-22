import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Rocket,
  CheckCircle2,
  Check,
  ArrowRight,
  Sparkles,
  X,
} from 'lucide-react'

import { EmptyState } from '@/components/feedback'
import { Badge, Button, IconButton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useVehicles } from '@/api/hooks/useVehicles'
import { useAlertRules, useNotificationChannels } from '@/api/hooks/useNotifications'
import { useDataState } from '@/hooks/useDataState'
import { combineDataStates, deriveDataState } from '@/api/dataState'
import { useNumberFormatting } from '@/hooks/useNumberFormatting'
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
  const successfulQueryTimestamps = [vehicles.dataUpdatedAt, rules.dataUpdatedAt, channels.dataUpdatedAt]
    .filter((timestamp): timestamp is number => typeof timestamp === 'number' && timestamp > 0)
  // The checklist depends on all three sources, so its freshness follows the oldest
  // successful read rather than the newest one.
  const updatedAt = successfulQueryTimestamps.length > 0
    ? Math.min(...successfulQueryTimestamps)
    : 0
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
      <WidgetShell
        title={title}
        icon={icon}
        dataState={dataState}
        updatedAt={updatedAt}
        isFetching={vehicles.isFetching || rules.isFetching || channels.isFetching}
        isStale={vehicles.isStale || rules.isStale || channels.isStale}
        isError={vehicles.isError || rules.isError || channels.isError}
        onRefresh={retry}
      >
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
    <IconButton icon={<X className="h-4 w-4" aria-hidden="true" />}
      label={t('checklist.dismiss', 'Dismiss')} aria-label={t('checklist.dismiss', 'Dismiss')} onClick={dismiss} />
  )

  return (
    <WidgetShell
      title={title}
      icon={icon}
      actions={headerActions}
      dataState={dataState}
      updatedAt={updatedAt}
      isFetching={vehicles.isFetching || rules.isFetching || channels.isFetching}
      isStale={vehicles.isStale || rules.isStale || channels.isStale}
      isError={vehicles.isError || rules.isError || channels.isError}
      onRefresh={retry}
    >
      <div className="flex flex-col h-full">
        {/* After hero: one headline ("X of Y done") + progress meter. The
            standalone % is dropped — the meter carries it (spec rule 3). */}
        <div className="flex flex-wrap items-end justify-between gap-2.5">
          <span className={cn(dashboardTokens.density.text, 'font-semibold text-[var(--text-primary)]')}>
            {t('checklist.progressDone', '{{done}} of {{total}} done', {
              done: fmtInt(completed),
              total: fmtInt(total),
            })}
          </span>
        </div>
        <div
          className={cn('mt-3 h-2 overflow-hidden bg-[var(--surface-2)]', dashboardTokens.radius.control)}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={completed}
          aria-label={t('checklist.progressDone', '{{done}} of {{total}} done', {
            done: completed,
            total,
          })}
        >
          <div
            className={cn(
              'h-full transition-all duration-slow motion-reduce:transition-none',
              dashboardTokens.radius.control,
              'bg-[var(--theme-primary)]',
            )}
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Task list — After `.check` rows: 18px round box + title only.
            Descriptions and per-task icons are dropped per the preview;
            the CTA and Unknown badge stay (navigation / trust semantics). */}
        {total === 0 ? (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<CheckCircle2 className="h-5 w-5" />}
            message={t('checklist.empty', 'No setup steps available right now.')}
            className="py-4 mt-3"
          />
        ) : (
          <ul className="mt-3 flex flex-col" data-testid="onboarding-checklist">
            {tasks.map((task) => {
              const source = taskSources[task.id as keyof typeof taskSources]
              const unknown = source != null && !source.hasData
              return (
                <li
                  key={task.id}
                  className={cn(
                    'flex flex-wrap items-center py-[7px] transition-colors',
                    dashboardTokens.density.row,
                    dashboardTokens.density.rowGap,
                  )}
                  data-testid={`checklist-task-${task.id}`}
                  data-complete={task.complete ? 'true' : 'false'}
                >
                  <span
                    className={cn(
                      'grid h-[18px] w-[18px] flex-none place-items-center rounded-full border-[1.5px]',
                      task.complete
                        ? 'border-[var(--semantic-success)] bg-[var(--semantic-success)] text-[var(--text-on-accent)]'
                        : 'border-[var(--border-default)] text-transparent',
                    )}
                    aria-hidden="true"
                  >
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 font-medium',
                      dashboardTokens.density.text,
                      task.complete
                        ? 'text-[var(--text-muted)] line-through'
                        : 'text-[var(--text-primary)]',
                    )}
                  >
                    {t(task.titleKey, task.titleFallback)}
                  </span>
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
      </div>
    </WidgetShell>
  )
}
