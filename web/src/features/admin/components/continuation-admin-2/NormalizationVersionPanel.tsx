import { useTranslation } from 'react-i18next';
import { Layers } from 'lucide-react';
import { LayoutCard } from '@/components/layout';
import { Text, Badge, Caption } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError, SectionErrorBoundary } from '@/components/feedback';
import type { NormalizationSummary } from '@/types/admin-operator-confidence';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { sortVersions, versionLabel, type SectionState } from '../data-quality/helpers';

export function NormalizationVersionPanel({ normalization, loading, error, onRetry }: SectionState & { normalization: NormalizationSummary | undefined }) {
  const { t } = useTranslation();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const legacyLabel = t('admin.dataQuality.legacyVersion', 'Legacy / unknown');
  const buckets = sortVersions(normalization?.versions);
  return (
    <LayoutCard title={t('admin.dataQuality.versionsTitle', 'Normalization version distribution')}
      description={t('admin.dataQuality.versionsSubtitle', 'Row counts per normalization contract version over the scoring window.')}>
      <SectionErrorBoundary name="data-quality-versions">
        {error ? <QueryError error={error} onRetry={onRetry} /> : loading && buckets.length === 0 ? <Skeleton height={180} />
          : buckets.length === 0 ? <EmptyState icon={<Layers className="h-8 w-8" />}
            action={{ label: t('common.refresh', 'Refresh'), onClick: onRetry }}
            title={t('admin.dataQuality.versionsEmptyTitle', 'No version evidence')}
            message={t('admin.dataQuality.versionsEmptyMessage', 'No signal rows were persisted in this window, so no normalization version could be observed.')} />
            : <ul className="space-y-3">{buckets.map((bucket) => {
              const attested = bucket.version != null && !(normalization?.required_version != null && bucket.version < normalization.required_version);
              const label = versionLabel(bucket.version, legacyLabel);
              const share = bucket.share_pct;
              return <li key={bucket.version == null ? 'legacy' : `v${bucket.version}`} className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2"><Text weight="medium" className="break-words">{label}</Text>
                    <Badge variant={attested ? 'success' : 'warning'}>{attested ? t('admin.dataQuality.versionAttested', 'Attested') : t('admin.dataQuality.versionUnattested', 'Unattested')}</Badge></div>
                  <Text className="tabular-nums">{t('admin.dataQuality.versionRows', '{{rows}} rows', { rows: fmtInt(bucket.sample_count) })}</Text>
                </div>
                <MetricBar value={share} max={100} label={label} showHeader={false} size="slim" fill="solid" color={attested ? '#34d399' : '#fbbf24'} />
                <Caption className="block tabular-nums">{share == null || !Number.isFinite(share) ? t('admin.dataQuality.shareUnknown', 'Share unknown')
                  : t('admin.dataQuality.versionShare', '{{share}}% of window', { share: fmtNumber(share) })}</Caption>
              </li>;
            })}</ul>}
      </SectionErrorBoundary>
    </LayoutCard>
  );
}
