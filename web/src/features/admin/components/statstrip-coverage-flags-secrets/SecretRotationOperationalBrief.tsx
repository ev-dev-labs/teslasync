import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { Text } from '@/components/ui';
import { QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { SecretRotationStatus } from '@/types/admin-operator-confidence';
import type { useSecretRotationPage } from '../../hooks/useSecretRotationPage';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { sourceStatus, sourceFreshness } from './sourceMetadata';

export function secretRotationMetrics(
  items: SecretRotationStatus[] | undefined, t: TFunction, rowLabel: (row: SecretRotationStatus) => string,
): StatMetric[] {
  const count = (severity: SecretRotationStatus['severity']) => items?.filter(row => row.severity === severity).length;
  const ages = items?.filter(row => row.age_days != null && Number.isFinite(row.age_days)) ?? [];
  const expiries = items?.filter(row => row.days_to_expiry != null && Number.isFinite(row.days_to_expiry)) ?? [];
  const oldest = ages.reduce<SecretRotationStatus | null>((best, row) =>
    best === null || row.age_days > best.age_days ? row : best, null);
  const soonest = expiries.reduce<SecretRotationStatus | null>((best, row) =>
    best === null || row.days_to_expiry! < best.days_to_expiry! ? row : best, null);
  const total = items?.length;
  const counts = [
    ['tracked', 'admin.secretRotation.totalLabel', 'Tracked secrets', total,
      items ? t('admin.secretRotation.kindCount', '{{count}} kinds tracked', {
        count: new Set(items.map(row => row.kind)).size,
      }) : t('admin.secretRotation.noData', 'No data')],
    ['healthy', 'admin.secretRotation.okLabel', 'Healthy', count('ok'),
      t('admin.secretRotation.okSub', '{{pct}} of tracked', {
        pct: total ? `${Math.round((count('ok')! / total) * 100)}%` : '—',
      })],
    ['soon', 'admin.secretRotation.warnLabel', 'Rotate soon', count('warn'),
      t('admin.secretRotation.warnSub', 'Approaching threshold')],
    ['overdue', 'admin.secretRotation.criticalLabel', 'Overdue', count('critical'),
      t('admin.secretRotation.criticalSub', 'Past critical threshold')],
  ] as const;
  return [
    ...counts.map(([occurrenceId, key, fallback, value, context]): StatMetric => ({
      metricId: 'count', occurrenceId, rawValue: value ?? null, label: t(key, fallback), context,
      description: t(`admin.secretRotation.statstrip.${occurrenceId}Description`, {
        defaultValue: {
          tracked: 'All returned tracked credentials, including unknown severity.',
          healthy: 'Returned credentials classified OK by their server-side per-kind thresholds.',
          soon: 'Returned credentials classified warn by their server-side per-kind thresholds.',
          overdue: 'Returned credentials classified critical by their server-side per-kind thresholds.',
        }[occurrenceId],
      }),
    })),
    {
      metricId: 'duration', occurrenceId: 'oldest', rawValue: oldest ? oldest.age_days * 86400 : null,
      label: t('admin.secretRotation.oldestLabel', 'Oldest secret'),
      description: t('admin.secretRotation.statstrip.oldestDescription', 'Largest known age among tracked credentials. Raw input is seconds; displayed in days.'),
      context: oldest ? rowLabel(oldest) : t('admin.secretRotation.noData', 'No data'),
      display: { units: { duration: 'd' } },
    },
    {
      metricId: 'duration', occurrenceId: 'expiry',
      rawValue: soonest?.days_to_expiry != null ? soonest.days_to_expiry * 86400 : null,
      label: t('admin.secretRotation.soonestExpiryLabel', 'Soonest expiry'),
      description: t('admin.secretRotation.statstrip.expiryDescription', 'Smallest known signed time to expiry. Negative values mean already expired. Raw input is seconds; displayed in days.'),
      context: soonest ? rowLabel(soonest) : t('admin.secretRotation.noExpiry', 'No expiry tracked'),
      display: { units: { duration: 'd' } },
    },
  ];
}

export function SecretRotationOperationalBrief({ controller }: { controller: ReturnType<typeof useSecretRotationPage> }) {
  const { t } = useTranslation();
  const { precision } = useNumberFormatting();
  const { query, source, rowLabel, subsystemMissing, showError, retry } = controller;
  const metrics = secretRotationMetrics(source.hasData ? query.data?.items ?? [] : undefined, t, rowLabel)
    .map(metric => metric.metricId === 'duration' ? { ...metric, display: { ...metric.display, precision } } : metric);
  const briefMetrics = useOperationalMetrics(metrics);
  const retained = source.hasData && (source.status === 'stale' || source.isRefreshing);
  const error = source.fatalError ?? source.refreshError;
  return <FadeIn><section aria-label={t('admin.secretRotation.kpis', 'Rotation summary')} data-retained={retained}>
    {retained && <Text role="status">{t('operationalSource.retained', 'Showing retained measurements')}</Text>}
    {!subsystemMissing && error && <Text role="alert">{error.message}</Text>}
    <OperationalBrief testId="secret-rotation-summary" compact metrics={briefMetrics}
      loading={source.status === 'initial'}
      eyebrow={t('admin.secretRotation.brief.eyebrow', 'Credential observability')}
      title={t('admin.secretRotation.brief.title', 'Rotation and expiry outlook')}
      description={t('admin.secretRotation.brief.description', 'Review server-classified rotation thresholds, known credential ages and signed time to expiry. This surface observes credentials; it does not rotate them.')}
      statusLabel={subsystemMissing ? t('admin.secretRotation.brief.unsupported', 'Tracker not configured') : sourceStatus(source.status, t)}
      statusTone={error ? 'warning' : 'neutral'}
      scope={<Text as="span" variant="caption">{t('admin.secretRotation.statstrip.period', 'Rotation tracker snapshot')}</Text>}
      freshness={<Text as="span" variant="caption">{sourceFreshness(source.updatedAt, t)}</Text>}
      provenance={t('admin.secretRotation.statstrip.provenance', 'Returned credentials and server-computed per-kind thresholds; not a selected date-range aggregate.')} />
    <Text variant="caption">{t('admin.secretRotation.statstrip.provenance', 'Returned credentials and server-computed per-kind thresholds; not a selected date-range aggregate.')}</Text>
    {source.hasData && <Text variant="caption">{t('admin.secretRotation.statstrip.unknown', '{{count}} tracked credentials have unknown severity', {
        count: (query.data?.items ?? []).filter(row => row.severity === 'unknown').length,
      })}</Text>}
    {showError && <QueryError error={source.fatalError} onRetry={retry} />}
  </section></FadeIn>;
}
