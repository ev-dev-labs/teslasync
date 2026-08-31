import { AlertTriangle, Clock3, ExternalLink, Gauge, Route, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Badge, GlassPanel, Text } from '@/components/ui';
import { AlertBanner } from '@/components/feedback';
import { Skeleton } from '@/components/feedback/Skeleton';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type { DriveFsdInsight, FsdAttributionConfidence } from '@/types/fsd';

interface SupervisedDrivingPanelProps {
  insight: DriveFsdInsight | undefined;
  isLoading: boolean;
  error?: unknown;
  isOngoing?: boolean;
}

const confidenceVariant: Record<
  FsdAttributionConfidence,
  'success' | 'info' | 'warning' | 'neutral'
> = {
  high: 'success',
  estimated: 'info',
  ambiguous: 'warning',
  unknown: 'neutral',
};

export function SupervisedDrivingPanel({
  insight,
  isLoading,
  error,
  isOngoing = false,
}: SupervisedDrivingPanelProps) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();

  if (isLoading) {
    return (
      <GlassPanel className="p-4 sm:p-5">
        <Skeleton className="h-28" />
      </GlassPanel>
    );
  }

  if (error) {
    return (
      <AlertBanner
        variant="warning"
        title={t('driveDetail.fsd.loadFailed', 'Supervised-driving evidence could not be loaded')}
      >
        {t(
          'driveDetail.fsd.loadFailedBody',
          'The rest of this drive remains available. Retry the page to load the cumulative-counter evidence.',
        )}
      </AlertBanner>
    );
  }

  const confidence = insight?.confidence ?? 'unknown';
  const evidence = insight?.evidence ?? [];
  const firstEvidence = evidence[0]?.start_at;
  const lastEvidence = evidence[evidence.length - 1]?.end_at;

  return (
    <section aria-label={t('driveDetail.fsd.section', 'Supervised driving')}>
      <GlassPanel className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                {t('driveDetail.fsd.title', 'Supervised driving')}
              </h2>
              <Badge variant={confidenceVariant[confidence]} size="sm">
                {isOngoing
                  ? t('driveDetail.inProgress', 'In progress')
                  : confidence === 'high'
                  ? t('driveDetail.fsd.highConfidence', 'High confidence')
                  : confidence === 'estimated'
                    ? t('driveDetail.fsd.estimated', 'Estimated')
                    : confidence === 'ambiguous'
                      ? t('driveDetail.fsd.ambiguous', 'Ambiguous')
                      : t('driveDetail.fsd.unknown', 'Unknown')}
              </Badge>
            </div>
            <Text as="p" size="xs" color="muted" className="mt-1">
              {t(
                'driveDetail.fsd.subtitle',
                'Reported supervised-driving distance from synchronized cumulative counters.',
              )}
            </Text>
          </div>
          <Link
            to="/fsd"
            className="inline-flex items-center gap-1 text-xs font-medium text-cyan-300 hover:text-cyan-200"
          >
            {t('driveDetail.fsd.openInsights', 'Open FSD Insights')}
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3">
            <Text as="div" size="xs" color="muted" className="flex items-center gap-1.5">
              <Route className="h-3.5 w-3.5" aria-hidden="true" />
              {t('driveDetail.fsd.distance', 'Reported distance')}
            </Text>
            <Text as="div" size="lg" weight="semibold" className="mt-1 tabular-nums">
              {insight?.fsd_distance_m == null
                ? '—'
                : `${confidence === 'high' ? '' : '~'}${formatDistance(
                    insight.fsd_distance_m,
                    { precision: 1 },
                  )}`}
            </Text>
          </div>
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3">
            <Text as="div" size="xs" color="muted" className="flex items-center gap-1.5">
              <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
              {t('driveDetail.fsd.share', 'Share of drive')}
            </Text>
            <Text as="div" size="lg" weight="semibold" className="mt-1 tabular-nums">
              {insight?.fsd_share_pct == null
                ? '—'
                : `${confidence === 'high' ? '' : '~'}${fmtNumber(insight.fsd_share_pct, 1)}%`}
            </Text>
          </div>
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3">
            <Text as="div" size="xs" color="muted" className="flex items-center gap-1.5">
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
              {t('driveDetail.fsd.evidenceWindow', 'Evidence window')}
            </Text>
            <Text as="div" size="sm" weight="medium" className="mt-1">
              {firstEvidence && lastEvidence
                ? `${formatDateTime(firstEvidence)} - ${formatDateTime(lastEvidence)}`
                : t('driveDetail.fsd.noPositiveEvidence', 'No positive counter increase')}
            </Text>
          </div>
        </div>

        {insight?.reset_affected && (
          <AlertBanner
            variant="warning"
            icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
            title={t('driveDetail.fsd.resetTitle', 'Counter reset affected this drive')}
          >
            {t(
              'driveDetail.fsd.resetBody',
              'Distance around the reset cannot be assigned exactly, so this value is not high confidence.',
            )}
          </AlertBanner>
        )}

        {insight?.evidence_truncated && (
          <AlertBanner
            variant="info"
            title={t('driveDetail.fsd.evidenceLimitedTitle', 'Route evidence limited')}
          >
            {t(
              'driveDetail.fsd.evidenceLimitedBody',
              'This drive produced more counter evidence than can be shown safely. The dashed map overlay displays only the first 512 coalesced intervals.',
            )}
          </AlertBanner>
        )}

        <Text as="p" size="xs" color="muted">
          {isOngoing
            ? `${t('driveDetail.inProgress', 'In progress')} · ${t('fsd.notMeasured', 'Not measured')}`
            : confidence === 'unknown'
            ? t(
                'driveDetail.fsd.unknownBody',
                'There are not enough paired observations to distinguish zero FSD use from missing data.',
              )
            : t(
                'driveDetail.fsd.method',
                'Evidence times bound where the counter increased; they do not identify exact FSD-active road segments.',
              )}
          {insight?.firmware_version
            ? ` ${t('driveDetail.fsd.firmware', 'Firmware: {{version}}.', {
                version: insight.firmware_version,
              })}`
            : ''}
        </Text>
      </GlassPanel>
    </section>
  );
}
