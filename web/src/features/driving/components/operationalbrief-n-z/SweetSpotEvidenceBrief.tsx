import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { EmptyState } from '@/components/feedback';
import { Badge, Text } from '@/components/ui';
import {
  DEFAULT_MIN_DRIVES_PER_BUCKET, type SweetSpotResult,
} from '../../lib/speedSweetSpot';
import { SpeedSweetSpotSectionBody } from '../speed-sweet-spot/SpeedSweetSpotSectionBody';
import type { SpeedSweetSpotSectionState } from '../speed-sweet-spot/types';
import { useSpeedSweetSpotDisplay } from '../speed-sweet-spot/useSpeedSweetSpotDisplay';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

interface SweetSpotEvidenceBriefProps {
  summary: SweetSpotResult;
  state: SpeedSweetSpotSectionState;
  className?: string;
  scope: string;
  resolved: boolean;
  retained: boolean;
}

export function SweetSpotEvidenceBrief({ summary, state, className, scope, resolved, retained }: SweetSpotEvidenceBriefProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatBand, formatDistance, formatEfficiency } = useSpeedSweetSpotDisplay();
  const coverage = summary.winningBandCoverage;
  const available = resolved && summary.sweetSpot != null;
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'eligible', rawValue: available ? summary.eligible : null,
      label: t('sweetSpot.evidence.eligible', 'Eligible drives') },
    { metricId: 'count', occurrenceId: 'winning-drives', rawValue: available ? coverage?.drives : null,
      label: t('sweetSpot.evidence.winningDrives', 'Drives in best band') },
    { metricId: 'distance', occurrenceId: 'winning-distance', rawValue: available ? coverage?.distanceM : null,
      label: t('sweetSpot.evidence.winningDistance', 'Distance in best band'),
      display: { formatter: (raw) => ({ value: formatDistance(raw), unit: '' }) } },
    { metricId: 'percent', occurrenceId: 'distance-share', rawValue: available && coverage ? coverage.distanceShare * 100 : null,
      label: t('sweetSpot.evidence.distanceShare', 'Eligible distance share') },
    { metricId: 'count', occurrenceId: 'qualified-bands', rawValue: available ? summary.qualifiedBandCount : null,
      label: t('sweetSpot.evidence.qualifiedBands', 'Qualified bands') },
  ];
  return (
    <section className={className} data-testid="speed-sweet-spot-evidence"
      aria-label={t('sweetSpot.sections.evidence', 'Sweet spot evidence and confidence')}>
      <DrivingSummaryBrief
        id="speed-sweet-spot-evidence-brief"
        title={t('sweetSpot.evidence.title', 'Evidence & confidence')}
        description={t('sweetSpot.evidence.subtitle', 'A band needs at least {{count}} eligible whole drives before it can rank.', {
          count: DEFAULT_MIN_DRIVES_PER_BUCKET,
        })}
        metrics={metrics} scope={scope} loading={state.isLoading} unavailable={!resolved || state.error != null}
        retained={retained}
        provenance={t('sweetSpot.brief.provenance', 'Distance-weighted eligible returned drives; sample floor and row cap are unchanged.')}
        actions={resolved ? <Badge variant={summary.sweetSpot != null ? 'success' : 'warning'} dot>
          {summary.sweetSpot != null ? t('sweetSpot.evidence.qualified', 'Qualified comparison')
            : t('sweetSpot.evidence.insufficient', 'Insufficient evidence')}
        </Badge> : undefined}
      />
      <SpeedSweetSpotSectionBody state={state} className="mt-4">
        {summary.sweetSpot == null ? <EmptyState message={t('sweetSpot.evidence.empty',
          'No speed band has enough eligible drives to support a best-band comparison in this window.')} /> : (
          <Text as="p" variant="bodySm">{summary.runnerUp != null
            ? t('sweetSpot.evidence.runnerUp', 'Next-best qualified band {{band}} measured {{gap}} higher than the winner ({{percent}}).', {
              band: formatBand(summary.runnerUp.band.fromKph, summary.runnerUp.band.toKph),
              gap: formatEfficiency(summary.runnerUp.gapWhPerKm), percent: `${fmtNumber(summary.runnerUp.gapShare * 100)}%`,
            }) : t('sweetSpot.evidence.noRunnerUp', 'Only one band qualifies, so there is no runner-up contrast yet.')}</Text>
        )}
      </SpeedSweetSpotSectionBody>
    </section>
  );
}
