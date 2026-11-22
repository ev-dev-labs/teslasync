import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldQuestion } from 'lucide-react'

import { cn } from '@/lib/cn'
import { severityTokens } from '@/lib/tokens'
import { Text } from '@/components/ui/Typography'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { MaybeLink } from './_MaybeLink'
import {
  accessGuidanceFor,
  classifyAccessBlock,
  type AccessBlockEvidence,
  type AccessBlockKind,
} from '@/lib/permissionGuidance'

/**
 * Permission explanation with request-access guidance (HELP-10).
 *
 * Answers the three questions a 401/403/feature-gate leaves open: what the
 * server decided, who can change it, and what to say when you ask. The steps
 * are rendered as an ordered list because they are a procedure, not a mood.
 *
 * Renders nothing when the evidence does not indicate an access block, so it
 * is safe to mount unconditionally next to a query result.
 */
export interface PermissionGuidanceNoticeProps {
  /** Pre-classified block kind. Takes priority over `evidence`. */
  kind?: AccessBlockKind
  evidence?: Omit<AccessBlockEvidence, 'online'>
  className?: string
  compact?: boolean
}

export function PermissionGuidanceNotice({
  kind,
  evidence,
  className,
  compact = false,
}: PermissionGuidanceNoticeProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const online = useOnlineStatus()
  const resolved =
    kind ?? (evidence ? classifyAccessBlock({ ...evidence, online }) : null)
  if (!resolved) return null

  const guidance = accessGuidanceFor(resolved)
  const warning = severityTokens.warn

  return (
    <section
      role="status"
      data-app-part="feedback"
      data-app-feedback-kind="notice"
      data-app-tone="warning"
      data-testid="permission-guidance"
      data-access-block={guidance.kind}
      className={cn(
        'grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 rounded-panel border bg-[var(--surface-1)] text-start forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
        warning.border,
        className,
      )}
      aria-labelledby={titleId}
    >
      <div data-app-part="feedback-icon" className={cn(
        'grid w-8 self-stretch place-items-center rounded-s-[inherit] border-e sm:w-10 forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]',
        warning.bg, warning.border, warning.fg,
      )} aria-hidden="true">
        <ShieldQuestion className="h-5 w-5" />
      </div>
      <div data-app-part="feedback-content" className="min-w-0 space-y-2 py-2.5 pe-3 [overflow-wrap:anywhere]">
        <div>
          <Text data-app-part="feedback-severity" size="xs" weight="semibold" className={cn('block uppercase forced-colors:text-[CanvasText]', warning.fg)}>
            {t('severity.warn', 'Warning')}
          </Text>
          <Text id={titleId} data-app-part="feedback-title" as="p" size="sm" weight="semibold" color="primary">
            {t(guidance.titleKey, guidance.titleFallback)}
          </Text>
        </div>
        <Text data-app-part="feedback-message" as="p" variant="bodySm">
          {t(guidance.explanationKey, guidance.explanationFallback)}
        </Text>

        {!compact && (
          <div data-app-part="feedback-detail" className="space-y-2">
            <Text as="p" variant="bodySm" color="muted">
              <span className="font-medium">
                {t('accessGuidance.grantedByLabel', 'Who can grant this')}:{' '}
              </span>
              {t(guidance.grantedByKey, guidance.grantedByFallback)}
            </Text>

            <div>
              <Text as="p" variant="caption">
                {t('accessGuidance.stepsLabel', 'How to request access')}
              </Text>
              <ol className="mt-1 list-decimal space-y-1 ps-5">
                {guidance.steps.map((step) => (
                  <li key={step.key}>
                    <Text as="span" variant="bodySm" color="muted">
                      {t(step.key, step.fallback)}
                    </Text>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}

        {guidance.actionTo && guidance.actionLabelKey && (
          <MaybeLink
            to={guidance.actionTo}
            data-app-part="feedback-actions button"
            data-app-variant="ghost"
            data-app-size="sm"
            className="inline-flex max-w-full items-center text-xs font-medium text-[var(--theme-primary)] underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] max-md:min-h-11 forced-colors:focus-visible:outline-[Highlight]"
            data-testid="permission-guidance-action"
          >
            {t(guidance.actionLabelKey, guidance.actionLabelFallback ?? '')}
          </MaybeLink>
        )}
      </div>
    </section>
  )
}
