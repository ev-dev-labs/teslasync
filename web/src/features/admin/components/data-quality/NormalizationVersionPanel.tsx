/**
 * Normalization-version distribution for the Data Quality page.
 *
 * Renders every `GROUP BY normalization_version` bucket the backend returned,
 * with its explicit row count and share of the window. The legacy/unknown
 * bucket (`version: null`) is shown FIRST and labelled as legacy — it is never
 * collapsed into "v0", because an absent attestation and an explicit
 * below-contract attestation are different provenance facts.
 *
 * Share bars are widths derived from live data, so an inline `style` width is
 * the sanctioned dynamic-value exception.
 */
import { useTranslation } from 'react-i18next';
import { Layers } from 'lucide-react';

import { GlassPanel, PanelTitle, Caption, Text, Badge } from '@/components/ui';
import { Skeleton, EmptyState, QueryError, SectionErrorBoundary } from '@/components/feedback';
import { fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { sortVersions, versionLabel, type SectionState } from './helpers';
import type { NormalizationSummary } from '@/types/admin-operator-confidence';

interface NormalizationVersionPanelProps extends SectionState {
  normalization: NormalizationSummary | undefined;
}

export function NormalizationVersionPanel({
  normalization,
  loading,
  error,
  onRetry,
}: NormalizationVersionPanelProps) {
  const { t } = useTranslation();

  const legacyLabel = t('admin.dataQuality.legacyVersion', 'Legacy / unknown');
  const requiredVersion = normalization?.required_version;
  const buckets = sortVersions(normalization?.versions);

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-1">
        {t('admin.dataQuality.versionsTitle', 'Normalization version distribution')}
      </PanelTitle>
      <Caption className="mb-3 block">
        {t(
          'admin.dataQuality.versionsSubtitle',
          'Row counts per normalization contract version over the scoring window.',
        )}
      </Caption>
      <SectionErrorBoundary name="data-quality-versions">
        {error ? (
          <QueryError error={error} onRetry={onRetry} />
        ) : loading && buckets.length === 0 ? (
          <Skeleton height={180} />
        ) : buckets.length === 0 ? (
          // no-action: buckets appear once telemetry lands; not a user-actionable surface
          <EmptyState
            icon={<Layers className="h-8 w-8" />}
            title={t('admin.dataQuality.versionsEmptyTitle', 'No version evidence')}
            message={t(
              'admin.dataQuality.versionsEmptyMessage',
              'No signal rows were persisted in this window, so no normalization version could be observed.',
            )}
          />
        ) : (
          <ul className="space-y-3">
            {buckets.map((bucket) => {
              const isLegacy = bucket.version == null;
              const belowContract =
                !isLegacy &&
                requiredVersion != null &&
                (bucket.version as number) < requiredVersion;
              const attested = !isLegacy && !belowContract;
              const share = bucket.share_pct;
              const width = share != null && Number.isFinite(share) ? Math.min(100, Math.max(0, share)) : 0;
              return (
                <li key={isLegacy ? 'legacy' : `v${bucket.version}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Text weight="medium" color="primary">
                        {versionLabel(bucket.version, legacyLabel)}
                      </Text>
                      <Badge variant={attested ? 'success' : 'warning'}>
                        {attested
                          ? t('admin.dataQuality.versionAttested', 'Attested')
                          : t('admin.dataQuality.versionUnattested', 'Unattested')}
                      </Badge>
                    </div>
                    <Text className="tabular-nums" color="primary">
                      {t('admin.dataQuality.versionRows', '{{rows}} rows', {
                        rows: fmtInt(bucket.sample_count),
                      })}
                    </Text>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        attested ? 'bg-emerald-400/70' : 'bg-amber-400/70',
                      )}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                  <Caption className="mt-1 block tabular-nums">
                    {share == null
                      ? t('admin.dataQuality.shareUnknown', 'Share unknown')
                      : t('admin.dataQuality.versionShare', '{{share}}% of window', {
                          share: share.toFixed(1),
                        })}
                  </Caption>
                </li>
              );
            })}
          </ul>
        )}
      </SectionErrorBoundary>
    </GlassPanel>
  );
}
