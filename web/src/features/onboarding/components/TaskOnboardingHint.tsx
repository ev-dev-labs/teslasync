import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Lightbulb, X } from 'lucide-react'

import { cn } from '@/lib/cn'
import { Button, Text } from '@/components/ui'
import type { OnboardingTaskDefinition } from '@/lib/onboardingTasks'

/**
 * A single, non-blocking onboarding hint (HELP-01).
 *
 * Deliberately unlike a tour step:
 *  - it is inline, not a spotlight over a dimmed page;
 *  - it never takes focus, so it cannot interrupt typing or navigation;
 *  - it has one action, one dismiss, and one "stop showing these" — no
 *    Next/Back, because there is no sequence to be trapped in;
 *  - it states the prerequisite, so a user who cannot do the task yet learns
 *    that instead of being blamed for not having done it.
 */
export interface TaskOnboardingHintProps {
  task: OnboardingTaskDefinition
  onComplete: () => void
  onDismiss: () => void
  onOptOut: () => void
  className?: string
}

export function TaskOnboardingHint({
  task,
  onComplete,
  onDismiss,
  onOptOut,
  className,
}: TaskOnboardingHintProps) {
  const { t } = useTranslation()

  return (
    <aside
      role="note"
      data-testid="task-onboarding-hint"
      data-task-id={task.id}
      aria-label={t(task.titleKey, task.titleFallback)}
      className={cn(
        'rounded-panel border border-[var(--theme-primary)]/30 bg-[rgba(var(--theme-primary-rgb),0.06)] p-3',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-[var(--theme-primary)]" aria-hidden />

        <div className="min-w-0 flex-1 space-y-1.5">
          <Text as="p" size="sm" weight="medium" color="primary">
            {t(task.titleKey, task.titleFallback)}
          </Text>
          <Text as="p" variant="bodySm">
            {t(task.bodyKey, task.bodyFallback)}
          </Text>
          <Text as="p" variant="bodySm" color="muted">
            {t(task.prerequisiteKey, task.prerequisiteFallback)}
          </Text>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Link
              to={task.action.to}
              onClick={onComplete}
              className="text-xs font-medium text-[var(--theme-primary)] underline-offset-2 hover:underline"
              data-testid="task-onboarding-action"
            >
              {t(task.action.labelKey, task.action.labelFallback)}
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onOptOut}
              className="h-auto px-1.5 py-0.5 text-2xs text-[var(--text-muted)]"
              data-testid="task-onboarding-optout"
            >
              {t('onboarding.tasks.optOut', 'Stop showing setup tips')}
            </Button>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          aria-label={t('onboarding.tasks.dismiss', 'Dismiss this tip')}
          className="h-8 w-8 shrink-0 p-0"
          data-testid="task-onboarding-dismiss"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </aside>
  )
}
