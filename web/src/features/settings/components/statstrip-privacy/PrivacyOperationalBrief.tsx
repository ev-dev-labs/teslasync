import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric, type StatPeriod } from '@/components/data-display';
import { Text } from '@/components/ui';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { QueryError } from '@/components/feedback';
import type { ConsentState } from '@/lib/cookieConsent';
import { RECENT_PAGES_MAX } from '@/lib/recentPages';
import { describeConsent } from '../privacy/consentMeta';

interface PrivacyOperationalBriefProps {
  recentCount: number;
  consent: ConsentState;
  requireConsent: boolean | null;
  policyLoading: boolean;
  policyError: Error | null;
  retained: boolean;
  onRetry: () => void;
}

export function PrivacyOperationalBrief({ recentCount, consent, requireConsent, policyLoading,
  policyError, retained, onRetry }: PrivacyOperationalBriefProps) {
  const { t } = useTranslation();
  const cp = describeConsent(consent, t);
  const period: StatPeriod = {
    kind: 'unknown',
    label: t('account.privacy.stats.sources', 'Browser-local privacy and deployment policy'),
    reason: t('account.privacy.stats.period', 'Local browser state and the latest deployment policy have no common date range.'),
  };
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'privacy-recent', rawValue: recentCount,
      label: t('account.privacy.kpi.recent', 'Recent pages stored'),
      context: t('account.privacy.kpi.recentMax', 'of {{max}} max', { max: RECENT_PAGES_MAX }) },
    { metricId: 'status', occurrenceId: 'privacy-consent', rawValue: cp.short,
      label: t('account.privacy.kpi.consent', 'Consent status'), context: cp.detail },
    { metricId: 'status', occurrenceId: 'privacy-policy',
      rawValue: requireConsent === null ? null : requireConsent
        ? t('account.privacy.kpi.policyRequired', 'Required')
        : t('account.privacy.kpi.policyOptional', 'Optional'),
      label: t('account.privacy.kpi.policy', 'Consent policy'),
      missingReason: requireConsent !== null ? undefined : policyLoading
        ? t('account.privacy.stats.policyLoading', 'Loading deployment consent policy')
        : t('account.privacy.kpi.loadError', 'Failed to load privacy policy'),
      context: requireConsent === null ? undefined : requireConsent
        ? t('account.privacy.kpi.policyRequiredSub', 'Consent gate enabled')
        : t('account.privacy.kpi.policyOptionalSub', 'No consent gate') },
    { metricId: 'text', occurrenceId: 'privacy-scope',
      rawValue: t('account.privacy.kpi.scopeValue', 'This browser'),
      label: t('account.privacy.kpi.scope', 'Data scope'),
      context: t('account.privacy.kpi.scopeSub', 'Local only — never synced') },
  ];
  const briefMetrics = useOperationalMetrics(metrics);
  const statusLabel = retained
    ? t('account.privacy.brief.retained', 'Retained deployment policy')
    : policyLoading
      ? t('account.privacy.stats.policyLoading', 'Loading deployment consent policy')
      : requireConsent === null
        ? t('account.privacy.brief.unavailable', 'Deployment policy unavailable')
        : t('account.privacy.brief.available', 'Deployment policy available');
  return <section aria-label={t('account.privacy.kpi.aria', 'Privacy summary')}>
    <OperationalBrief compact testId="privacy-summary" metrics={briefMetrics}
      eyebrow={t('account.privacy.brief.eyebrow', 'Browser privacy')}
      title={t('account.privacy.brief.title', 'Browser-local privacy')}
      description={t('account.privacy.brief.description', 'Manage local page history and your consent choice alongside the deployment policy.')}
      statusLabel={statusLabel} statusTone={policyLoading ? 'neutral' : retained || requireConsent === null ? 'warning' : 'info'}
      scope={<Text as="span" variant="caption">
        {period.label} · {period.kind === 'unknown' ? period.reason : undefined}
      </Text>}
      provenance={period.label} />
    {policyError && <QueryError error={policyError} onRetry={onRetry} />}
  </section>;
}
