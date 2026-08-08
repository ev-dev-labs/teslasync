import { Award, CircleGauge, Info, Route } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import {
  Badge,
  GlassPanel,
  MetricLabel,
  MetricValue,
  PanelTitle,
  Text,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';

import {
  DEFAULT_MIN_DRIVES_PER_BUCKET,
  type SweetSpotResult,
} from '../../lib/speedSweetSpot';
import { SpeedSweetSpotSectionBody } from './SpeedSweetSpotSectionBody';
import type { SpeedSweetSpotSectionState } from './types';
import { useSpeedSweetSpotDisplay } from './useSpeedSweetSpotDisplay';

interface SweetSpotEvidenceProps {
  summary: SweetSpotResult;
  state: SpeedSweetSpotSectionState;
  className?: string;
}

export function SweetSpotEvidence({
  summary,
  state,
  className,
}: SweetSpotEvidenceProps) {
  const { t } = useTranslation();
  const { formatBand, formatDistance, formatEfficiency } =
    useSpeedSweetSpotDisplay();
  const coverage = summary.winningBandCoverage;
  const metrics = [
    {
      value: fmtInt(summary.eligible),
      label: t('sweetSpot.evidence.eligible', 'Eligible drives'),
    },
    {
      value: coverage != null ? fmtInt(coverage.drives) : '—',
      label: t('sweetSpot.evidence.winningDrives', 'Drives in best band'),
    },
    {
      value: coverage != null ? formatDistance(coverage.distanceM) : '—',
      label: t('sweetSpot.evidence.winningDistance', 'Distance in best band'),
    },
    {
      value:
        coverage != null
          ? `${fmtNumber(coverage.distanceShare * 100, 1)}%`
          : '—',
      label: t('sweetSpot.evidence.distanceShare', 'Eligible distance share'),
    },
    {
      value: fmtInt(summary.qualifiedBandCount),
      label: t('sweetSpot.evidence.qualifiedBands', 'Qualified bands'),
    },
  ];

  return (
    <GlassPanel
      className={cn('h-full p-5 sm:p-6', className)}
      role="region"
      aria-label={t(
        'sweetSpot.sections.evidence',
        'Sweet spot evidence and confidence',
      )}
      data-testid="speed-sweet-spot-evidence"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Award className="h-4 w-4 text-emerald-300" aria-hidden="true" />
          {t('sweetSpot.evidence.title', 'Evidence & confidence')}
        </PanelTitle>
        <Badge
          variant={summary.sweetSpot != null ? 'success' : 'warning'}
          dot
        >
          {summary.sweetSpot != null
            ? t('sweetSpot.evidence.qualified', 'Qualified comparison')
            : t('sweetSpot.evidence.insufficient', 'Insufficient evidence')}
        </Badge>
      </div>
      <Text as="p" variant="caption" className="mt-1">
        {t(
          'sweetSpot.evidence.subtitle',
          'A band needs at least {{count}} eligible whole drives before it can rank.',
          { count: DEFAULT_MIN_DRIVES_PER_BUCKET },
        )}
      </Text>

      <SpeedSweetSpotSectionBody state={state} className="mt-4 min-h-72">
        {summary.sweetSpot == null ? (
          <EmptyState /* no-action: more returned drives are required for qualification. */
            className="min-h-64"
            icon={<Info className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'sweetSpot.evidence.empty',
              'No speed band has enough eligible drives to support a best-band comparison in this window.',
            )}
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {metrics.map((metric) => (
                <div
                  key={metric.label}
                  className="rounded-xl bg-[var(--surface-2)] p-3"
                >
                  <MetricValue>{metric.value}</MetricValue>
                  <MetricLabel>{metric.label}</MetricLabel>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-xl border border-[var(--border-subtle)] p-3">
              {summary.runnerUp != null ? (
                <div className="flex items-start gap-2">
                  <CircleGauge
                    className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300"
                    aria-hidden="true"
                  />
                  <Text as="p" variant="bodySm">
                    {t(
                      'sweetSpot.evidence.runnerUp',
                      'Next-best qualified band {{band}} measured {{gap}} higher than the winner ({{percent}}).',
                      {
                        band: formatBand(
                          summary.runnerUp.band.fromKph,
                          summary.runnerUp.band.toKph,
                        ),
                        gap: formatEfficiency(summary.runnerUp.gapWhPerKm, 1),
                        percent: `${fmtNumber(
                          summary.runnerUp.gapShare * 100,
                          1,
                        )}%`,
                      },
                    )}
                  </Text>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <Route
                    className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"
                    aria-hidden="true"
                  />
                  <Text as="p" variant="bodySm">
                    {t(
                      'sweetSpot.evidence.noRunnerUp',
                      'Only one band qualifies, so there is no runner-up contrast yet.',
                    )}
                  </Text>
                </div>
              )}
            </div>
          </>
        )}
      </SpeedSweetSpotSectionBody>
    </GlassPanel>
  );
}
