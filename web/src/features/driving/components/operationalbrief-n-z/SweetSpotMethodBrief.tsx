import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { EmptyState } from '@/components/feedback';
import { Badge, Text } from '@/components/ui';
import { formatDayKey } from '@/lib/dateFormat';
import {
  DEFAULT_BUCKET_KPH, DEFAULT_MIN_DRIVES_PER_BUCKET, MIN_ELIGIBLE_DISTANCE_M,
  MIN_ELIGIBLE_DURATION_S, type SweetSpotResult,
} from '../../lib/speedSweetSpot';
import { SpeedSweetSpotSectionBody } from '../speed-sweet-spot/SpeedSweetSpotSectionBody';
import type { SpeedSweetSpotSectionState } from '../speed-sweet-spot/types';
import { useSpeedSweetSpotDisplay } from '../speed-sweet-spot/useSpeedSweetSpotDisplay';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

interface SweetSpotMethodBriefProps {
  summary: SweetSpotResult;
  start: string;
  end: string;
  windowLimit: number;
  state: SpeedSweetSpotSectionState;
  resolved: boolean;
  retained: boolean;
}

export function SweetSpotMethodBrief({ summary, start, end, windowLimit, state, resolved, retained }: SweetSpotMethodBriefProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs } = useSpeedSweetSpotDisplay();
  const dateOptions = { locale: unitPrefs.locale, style: 'long' as const };
  const windowLabel = t('sweetSpot.method.windowLabel', '{{start}} – {{end}} selected window', {
    start: formatDayKey(start, dateOptions), end: formatDayKey(end, dateOptions),
  });
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'returned', rawValue: resolved ? summary.observed : null,
      label: t('sweetSpot.method.returned', 'Rows returned') },
    { metricId: 'count', occurrenceId: 'eligible', rawValue: resolved ? summary.eligible : null,
      label: t('sweetSpot.method.eligible', 'Eligible drives') },
    { metricId: 'count', occurrenceId: 'excluded', rawValue: resolved ? summary.excluded : null,
      label: t('sweetSpot.method.excluded', 'Excluded drives') },
  ];
  const methods = [
    t('sweetSpot.method.eligibility', 'Eligibility requires positive measured energy and average speed, at least {{distance}} km, and at least {{minutes}} minutes.', {
      distance: MIN_ELIGIBLE_DISTANCE_M / 1000, minutes: MIN_ELIGIBLE_DURATION_S / 60,
    }),
    t('sweetSpot.method.buckets', 'Whole-drive average speed is grouped into {{width}} km/h half-open bands; at least {{count}} drives qualify a band.', {
      width: DEFAULT_BUCKET_KPH, count: DEFAULT_MIN_DRIVES_PER_BUCKET,
    }),
    t('sweetSpot.method.weighting', 'Band, monthly, and overall consumption use total energy ÷ total distance, not an average of drive-level ratios.'),
    t('sweetSpot.method.monthly', 'Monthly average speed is total eligible distance ÷ total eligible duration. Drives with malformed dates stay in non-calendar aggregates.'),
    t('sweetSpot.method.scatter', 'The scatter shows at most {{limit}} evenly spaced chronological points, including the endpoints; all eligible drives feed every aggregate.', {
      limit: summary.scatterLimit,
    }),
    t('sweetSpot.method.scope', 'This is whole-drive average-speed evidence, not instantaneous cruising speed and not a recommended road speed.'),
    t('sweetSpot.method.confounders', 'Route, weather, elevation, HVAC, traffic, and trip length can confound the association. The observed gap is descriptive, not causal and not a savings forecast.'),
  ];
  return (
    <section data-testid="speed-sweet-spot-method" aria-label={t('sweetSpot.sections.method', 'Coverage and methodology')}>
      <DrivingSummaryBrief
        id="speed-sweet-spot-method-brief"
        title={t('sweetSpot.method.title', 'Coverage & methodology')}
        description={t('sweetSpot.brief.methodDescription', 'Returned, eligible, and excluded counts reconcile the same selected-window sample.')}
        metrics={metrics} scope={windowLabel} loading={state.isLoading}
        unavailable={!resolved || state.error != null} retained={retained}
        provenance={t('sweetSpot.brief.provenance', 'Distance-weighted eligible returned drives; sample floor and row cap are unchanged.')}
        actions={resolved ? <Badge variant={summary.historyCapReached ? 'warning' : 'neutral'} dot>
          {summary.historyCapReached ? t('sweetSpot.method.capReached', '{{limit}}-row cap reached', { limit: fmtInt(windowLimit) })
            : t('sweetSpot.method.belowCap', 'Observed window below API cap')}
        </Badge> : undefined}
      />
      <SpeedSweetSpotSectionBody state={state} className="mt-4">
        {summary.observed === 0 && <EmptyState message={t('sweetSpot.method.empty', 'Coverage will appear when the selected window returns drives.')} />}
        <Text as="p" variant="caption">{summary.historyCapReached
          ? t('sweetSpot.method.capped', 'The request returned {{limit}} rows, so this describes the observed selected-window subset; additional drives in the date range may not be represented.', { limit: fmtInt(windowLimit) })
          : t('sweetSpot.method.window', 'This describes all {{count}} rows returned for the selected window, up to the {{limit}}-row API limit.', {
            count: summary.observed, limit: fmtInt(windowLimit),
          })}</Text>
        <ul className="mt-4 space-y-3">{methods.map((method) => <li key={method}>
          <Text as="span" variant="bodySm">{method}</Text>
        </li>)}</ul>
      </SpeedSweetSpotSectionBody>
    </section>
  );
}
