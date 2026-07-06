import { useTranslation } from 'react-i18next'
import { Cookie, History, MonitorSmartphone, ShieldCheck } from 'lucide-react'

import { MetricCard } from '@/components/data-display'
import { Skeleton, QueryError } from '@/components/feedback'
import type { ConsentState } from '@/lib/cookieConsent'
import { RECENT_PAGES_MAX } from '@/lib/recentPages'

import { describeConsent } from './consentMeta'

interface PrivacyKpiCardsProps {
  /** Number of recently-viewed pages stored in this browser. */
  recentCount: number
  /** Current cookie/analytics consent decision. */
  consent: ConsentState
  /** Whether the deployment gates optional reporting on consent. */
  requireConsent: boolean
  /** `/system/version` load state — the policy card needs it. */
  isLoading: boolean
  isError: boolean
  error?: unknown
  onRetry?: () => void
}

/**
 * KPI band for the Privacy page. Presentational: the page hands down the
 * browser-local counters and the deployment policy flag. Renders four metric
 * cards (or matching skeletons while `/system/version` is in flight) so the
 * layout never jumps, and a single retryable error if the policy can't load.
 */
export function PrivacyKpiCards({
  recentCount,
  consent,
  requireConsent,
  isLoading,
  isError,
  error,
  onRetry,
}: PrivacyKpiCardsProps) {
  const { t } = useTranslation()
  const cp = describeConsent(consent, t)

  // Even when the caller flags an error without supplying an error object,
  // surface a retryable failure card so the band never collapses to a blank
  // <section> — QueryError renders nothing for a falsy error.
  const shownError =
    isError && !error
      ? new Error(t('account.privacy.kpi.loadError', 'Failed to load privacy policy'))
      : error

  return (
    <section aria-label={t('account.privacy.kpi.aria', 'Privacy summary')}>
      {isError ? (
        <QueryError error={shownError} onRetry={onRetry} />
      ) : (
        <div
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
          aria-busy={isLoading}
        >
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={76} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('account.privacy.kpi.recent', 'Recent pages stored')}
                value={recentCount ?? 0}
                subtitle={t('account.privacy.kpi.recentMax', {
                  defaultValue: 'of {{max}} max',
                  max: RECENT_PAGES_MAX,
                })}
                icon={<History className="h-5 w-5" aria-hidden="true" />}
                color="cyan"
              />
              <MetricCard
                label={t('account.privacy.kpi.consent', 'Consent status')}
                value={cp.short}
                icon={<Cookie className="h-5 w-5" aria-hidden="true" />}
                color={cp.color}
              />
              <MetricCard
                label={t('account.privacy.kpi.policy', 'Consent policy')}
                value={
                  requireConsent
                    ? t('account.privacy.kpi.policyRequired', 'Required')
                    : t('account.privacy.kpi.policyOptional', 'Optional')
                }
                subtitle={
                  requireConsent
                    ? t('account.privacy.kpi.policyRequiredSub', 'Consent gate enabled')
                    : t('account.privacy.kpi.policyOptionalSub', 'No consent gate')
                }
                icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
                color="blue"
              />
              <MetricCard
                label={t('account.privacy.kpi.scope', 'Data scope')}
                value={t('account.privacy.kpi.scopeValue', 'This browser')}
                subtitle={t('account.privacy.kpi.scopeSub', 'Local only — never synced')}
                icon={<MonitorSmartphone className="h-5 w-5" aria-hidden="true" />}
                color="purple"
              />
            </>
          )}
        </div>
      )}
    </section>
  )
}

export default PrivacyKpiCards
