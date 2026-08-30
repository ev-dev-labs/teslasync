import { useTranslation } from 'react-i18next'
import { ShieldQuestion } from 'lucide-react'

import { cn } from '@/lib/cn'
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
  const online = useOnlineStatus()
  const resolved =
    kind ?? (evidence ? classifyAccessBlock({ ...evidence, online }) : null)
  if (!resolved) return null

  const guidance = accessGuidanceFor(resolved)

  return (
    <section
      role="status"
      data-testid="permission-guidance"
      data-access-block={guidance.kind}
      className={cn(
        'rounded-panel border border-[var(--glass-border)] bg-[var(--surface-1)] p-4',
        className,
      )}
      aria-label={t(guidance.titleKey, guidance.titleFallback)}
    >
      <div className="flex items-start gap-3">
        <ShieldQuestion className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <Text as="p" size="sm" weight="medium" color="primary">
            {t(guidance.titleKey, guidance.titleFallback)}
          </Text>
          <Text as="p" variant="bodySm">
            {t(guidance.explanationKey, guidance.explanationFallback)}
          </Text>

          {!compact && (
            <>
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
                <ol className="mt-1 list-decimal space-y-1 pl-5">
                  {guidance.steps.map((step) => (
                    <li key={step.key}>
                      <Text as="span" variant="bodySm" color="muted">
                        {t(step.key, step.fallback)}
                      </Text>
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}

          {guidance.actionTo && guidance.actionLabelKey && (
            <MaybeLink
              to={guidance.actionTo}
              className="inline-flex text-xs font-medium text-[var(--theme-primary)] underline-offset-2 hover:underline"
              data-testid="permission-guidance-action"
            >
              {t(guidance.actionLabelKey, guidance.actionLabelFallback ?? '')}
            </MaybeLink>
          )}
        </div>
      </div>
    </section>
  )
}
