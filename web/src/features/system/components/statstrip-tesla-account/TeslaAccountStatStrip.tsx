import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { QueryError } from '@/components/feedback';
import { Text } from '@/components/ui';
import type { TeslaUserProfile } from '@/api/hooks/useUser';
import { formatDate, formatDateTime, formatRelative } from '@/lib/dateFormat';

interface Props {
  profile: TeslaUserProfile | null;
  fetchedAt: string | null;
  hasData: boolean;
  loading: boolean;
  error: Error | null;
  retained: boolean;
  onRetry: () => void;
}

export function TeslaAccountStatStrip({ profile, fetchedAt, hasData, loading, error, retained, onRetry }: Props) {
  const { t } = useTranslation();
  const hasFetchTimestamp = fetchedAt != null && Number.isFinite(Date.parse(fetchedAt));
  const metrics: StatMetric[] = [
    { metricId: 'status', occurrenceId: 'sync-status',
      rawValue: !hasData ? null : fetchedAt ? t('teslaAccount.synced', 'Synced') : t('teslaAccount.never', 'Never synced'),
      label: t('teslaAccount.kpi.sync', 'Sync status'),
      context: fetchedAt ? <><Text as="span" variant="caption">{formatRelative(fetchedAt)}</Text>
        {' · '}<Text as="span" variant="caption">{formatDateTime(fetchedAt)}</Text></>
        : hasData ? t('teslaAccount.neverSyncedShort', 'Not synced yet') : '—',
      description: t('statstrip.teslaAccount.syncDescription', 'Sync status comes from the source fetched-at timestamp, not the browser query update time.') },
    { metricId: 'identifier', occurrenceId: 'account-id', rawValue: profile?.id,
      display: { identifierPrefix: '#' }, label: t('teslaAccount.kpi.accountId', 'Account ID'),
      context: t('teslaAccount.kpi.accountIdSub', 'Fleet API identity'),
      description: t('statstrip.teslaAccount.idDescription', 'The source Tesla Fleet API account identity, not the local TeslaSync user ID.') },
    { metricId: 'text', occurrenceId: 'member-since',
      rawValue: profile?.created_at ? formatDate(profile.created_at) : null,
      label: t('teslaAccount.kpi.memberSince', 'Member since'),
      context: profile?.created_at ? <><Text as="span" variant="caption">{formatRelative(profile.created_at)}</Text>
        {' · '}<Text as="span" variant="caption">{formatDateTime(profile.created_at)}</Text></> : '—',
      description: t('statstrip.teslaAccount.memberDescription', 'Source account creation date; the full source date and relative context are retained.') },
    { metricId: 'text', occurrenceId: 'last-updated',
      rawValue: profile?.updated_at ? formatRelative(profile.updated_at) : null,
      label: t('teslaAccount.kpi.updated', 'Last updated'),
      context: profile?.updated_at ? <><Text as="span" variant="caption">{formatDate(profile.updated_at)}</Text>
        {' · '}<Text as="span" variant="caption">{formatDateTime(profile.updated_at)}</Text></> : '—',
      description: t('statstrip.teslaAccount.updatedDescription', 'Source profile update date; independent of the last fetch from Tesla.') },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  return <section aria-label={t('teslaAccount.kpis', 'Account summary')}>
    <OperationalBrief compact testId="tesla-account-summary" metrics={operationalMetrics} loading={loading && !retained}
      eyebrow={t('teslaAccount.title', 'Tesla account')} title={t('teslaAccount.kpis', 'Account summary')}
      description={t('teslaAccount.subtitle', 'Your Tesla account profile synced from the Fleet API')}
      statusLabel={retained ? t('operationalSummary.retained', 'Retained source data')
        : error ? t('operationalSummary.unavailable', 'Source unavailable')
          : loading ? t('operationalSummary.loading', 'Loading sources')
            : !hasData ? t('operationalSummary.unknown', 'Source values unknown')
              : fetchedAt ? t('teslaAccount.synced', 'Synced') : t('teslaAccount.never', 'Never synced')}
      statusTone={retained || error ? 'warning' : 'neutral'}
      scope={t('statstrip.teslaAccount.period', 'Fleet API profile snapshot')}
      freshness={<>{hasFetchTimestamp && fetchedAt
        ? t('statstrip.teslaAccount.fetchedSnapshot', 'Source fetched at {{date}}', { date: formatDateTime(fetchedAt) })
        : t('statstrip.teslaAccount.unknownSnapshot', 'No source fetch timestamp recorded; freshness is unknown')}
        {retained && <> · {t('developerReference.stats.state.retained', 'Showing retained measurements')}</>}</>}
      provenance={t('teslaAccount.kpi.accountIdSub', 'Fleet API identity')} />
    {error && <QueryError error={error} onRetry={onRetry}
      resourceName={t('teslaAccount.resource', 'Tesla profile')} />}
  </section>;
}
