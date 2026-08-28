import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'

import { cn } from '@/lib/cn'
import { Text } from '@/components/ui/Typography'
import { BUTTON_BASE, BUTTON_VARIANTS } from '@/components/ui/Button'
import { MaybeLink } from './_MaybeLink'
import {
  getEmptyStateGuidance,
  type EmptyStateGuidance,
} from '@/lib/emptyStateGuidance'

/**
 * The governed actionable empty state (HELP-02).
 *
 * Renders the four answers an empty panel owes the user — meaning,
 * prerequisite, likely cause, and one action — from the registry in
 * `lib/emptyStateGuidance`, so copy is reviewed in one place rather than
 * re-invented per page.
 *
 * This is panel *content*. The surrounding section shell must still render:
 * hiding the panel is what created the ambiguity this component exists to
 * remove. `role="status"` matches `<EmptyState>` so assistive tech announces
 * the surface the same way everywhere.
 *
 * An unknown `guidanceId` renders the fallback message rather than nothing —
 * a typo must degrade to the old behaviour, never to a blank panel.
 */
export interface ActionableEmptyStateProps {
  /** Registry id, e.g. `drives.list`. */
  guidanceId: string
  /**
   * Overrides the registry's "likely cause" when the caller has better
   * evidence (e.g. the unavailability classifier says the vehicle is asleep).
   */
  likelyCauseOverride?: ReactNode
  /** Fallback message when `guidanceId` is not in the registry. */
  fallbackMessage?: string
  icon?: ReactNode
  className?: string
}

const linkButtonClasses = cn(BUTTON_BASE, BUTTON_VARIANTS.secondary, 'h-10 px-4 text-sm')

function GuidanceRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <Text as="span" variant="caption" className="shrink-0 sm:w-40 sm:text-right">
        {label}
      </Text>
      <Text as="span" variant="bodySm" color="muted" className="min-w-0 flex-1">
        {children}
      </Text>
    </div>
  )
}

/**
 * The prerequisite + likely-cause rows on their own.
 *
 * Exported so an existing bespoke empty state can adopt the governed
 * explanation without having its established title, message and CTA rewritten
 * — the two halves of the pattern can be adopted independently, which is what
 * makes incremental adoption possible at all.
 *
 * Renders nothing for an unknown id.
 */
export function EmptyStateGuidanceDetails({
  guidanceId,
  likelyCauseOverride,
  className,
}: {
  guidanceId: string
  likelyCauseOverride?: ReactNode
  className?: string
}) {
  const { t } = useTranslation()
  const guidance = getEmptyStateGuidance(guidanceId)
  if (!guidance) return null

  return (
    <div
      className={cn('w-full max-w-2xl space-y-1.5 text-left', className)}
      data-testid="empty-state-guidance"
      data-guidance-id={guidance.id}
    >
      <GuidanceRow label={t('emptyState.label.prerequisite', 'What has to happen first')}>
        {t(guidance.prerequisiteKey, guidance.prerequisiteFallback)}
      </GuidanceRow>
      <GuidanceRow label={t('emptyState.label.likelyCause', 'Most likely reason')}>
        {likelyCauseOverride ?? t(guidance.likelyCauseKey, guidance.likelyCauseFallback)}
      </GuidanceRow>
    </div>
  )
}

export function ActionableEmptyState({
  guidanceId,
  likelyCauseOverride,
  fallbackMessage,
  icon,
  className,
}: ActionableEmptyStateProps) {
  const { t } = useTranslation()
  const guidance: EmptyStateGuidance | null = getEmptyStateGuidance(guidanceId)

  if (!guidance) {
    return (
      <div
        role="status"
        data-testid="actionable-empty-state"
        data-guidance-id={guidanceId}
        className={cn('px-4 py-10 text-center', className)}
      >
        <Text as="p" variant="bodySm">
          {fallbackMessage ?? t('emptyState.generic', 'No data available yet.')}
        </Text>
      </div>
    )
  }

  return (
    <div
      role="status"
      data-testid="actionable-empty-state"
      data-guidance-id={guidance.id}
      className={cn('flex flex-col items-center gap-4 px-4 py-10 text-center', className)}
    >
      <div
        className="rounded-shape-xl border border-[var(--border-default)] bg-[var(--surface-2)] p-3 text-[var(--theme-primary)]"
        aria-hidden
      >
        {icon ?? <Info className="h-5 w-5" />}
      </div>

      <Text as="p" variant="body" className="max-w-xl leading-relaxed">
        {t(guidance.meaningKey, guidance.meaningFallback)}
      </Text>

      <div className="w-full max-w-2xl space-y-1.5 text-left">
        <GuidanceRow label={t('emptyState.label.prerequisite', 'What has to happen first')}>
          {t(guidance.prerequisiteKey, guidance.prerequisiteFallback)}
        </GuidanceRow>
        <GuidanceRow label={t('emptyState.label.likelyCause', 'Most likely reason')}>
          {likelyCauseOverride ?? t(guidance.likelyCauseKey, guidance.likelyCauseFallback)}
        </GuidanceRow>
      </div>
      <MaybeLink
        to={guidance.action.to}
        className={linkButtonClasses}
        data-testid="actionable-empty-state-action"
      >
        {t(guidance.action.labelKey, guidance.action.labelFallback)}
      </MaybeLink>
    </div>
  )
}
