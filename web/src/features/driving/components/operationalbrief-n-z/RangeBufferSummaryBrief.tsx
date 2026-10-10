import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { AlertBanner } from '@/components/feedback';
import { Select, Text } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { RANGE_BUFFER_THRESHOLDS, type RangeBufferResult } from '../../lib/rangeBuffer';
import {
  rangeBufferBandLabel, rangeBufferNumber, rangeBufferPercent,
} from '../range-buffer/labels';
import { RangeBufferQueryStatus } from '../range-buffer/RangeBufferQueryStatus';
import { RangeBufferSectionBody } from '../range-buffer/RangeBufferSectionBody';
import type { RangeBufferDistanceFormatter, RangeBufferQueryState } from '../range-buffer/types';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

interface RangeBufferSummaryBriefProps {
  kind: 'arrivals' | 'context' | 'support' | 'accounting';
  result: RangeBufferResult;
  state: RangeBufferQueryState;
  locale: string;
  scope: string;
  thresholdPct: number;
  onThresholdChange: (value: number) => void;
  formatDistance: RangeBufferDistanceFormatter;
}

export function RangeBufferSummaryBrief({
  kind, result, state, locale, scope, thresholdPct, onThresholdChange, formatDistance,
}: RangeBufferSummaryBriefProps) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const resolved = state.vehicleSelected && state.isResolved && !state.error;
  const contextResolved = resolved && result.accounting.includedRows > 0;
  const accounting = result.accounting;
  const context = result.driveContext;
  const support = result.coverage.support;
  const unresolvedSubtitle = !state.vehicleSelected
    ? t('rangeBuffer.states.selectVehicleKpi', 'Select a vehicle above to load arrival evidence.')
    : state.isLoading
      ? t('rangeBuffer.states.loadingKpi', 'Waiting for returned drive history...')
      : state.error
        ? t('rangeBuffer.states.errorKpi', 'Drive history is unavailable; use the status below to retry.')
        : !state.isResolved
          ? t('rangeBuffer.states.pendingKpi', 'Drive-history availability has not resolved.')
          : null;
  const percentDisplay = {
    formatter: (raw: number) => ({ value: rangeBufferPercent(raw, locale), unit: '' }),
  };
  const countDisplay = {
    formatter: (raw: number) => ({ value: fmtInt(raw), unit: '' }),
  };
  const count = (id: string, raw: number, label: string, description: string, available = resolved): StatMetric => ({
    occurrenceId: id, metricId: 'count', rawValue: available ? raw : null,
    label, description: resolved ? description : unresolvedSubtitle ?? description, display: countDisplay,
  });
  const percent = (id: string, raw: number | null, label: string, description: string, available = resolved): StatMetric => ({
    occurrenceId: id, metricId: 'percent', rawValue: available ? raw : null,
    label, description: resolved ? description : unresolvedSubtitle ?? description, display: percentDisplay,
  });
  const score = (id: string, label: string): StatMetric => ({
    occurrenceId: id, metricId: 'score', rawValue: resolved ? support.index : null,
    label, description: resolved ? rangeBufferBandLabel(t, support.band) : unresolvedSubtitle ?? undefined,
    display: { formatter: (raw) => ({ value: `${rangeBufferNumber(raw, locale)}/100`, unit: '' }) },
  });
  const bands = {
    arrivals: {
      id: 'range-buffer-kpis',
      title: t('rangeBuffer.kpis.title', 'Observed arrival-buffer evidence'),
      description: t('rangeBuffer.brief.arrivalsDescription', 'Observed arrivals in returned drive history; the planning threshold is descriptive, not a guarantee.'),
      metrics: [
        count('included', accounting.includedRows, t('rangeBuffer.kpis.included', 'Included arrivals'),
          t('rangeBuffer.kpis.returned', '{{count}} rows returned', { count: accounting.returnedRows })),
        percent('median', result.summary.medianPct, t('rangeBuffer.kpis.median', 'Median arrival'),
          t('rangeBuffer.kpis.driveWeighted', 'drive-weighted observed p50')),
        percent('p10', result.summary.p10Pct, t('rangeBuffer.kpis.p10', 'Observed p10 arrival'),
          t('rangeBuffer.kpis.downside', 'lower-tail historical percentile')),
        percent('below-threshold', result.summary.belowThresholdShare == null ? null : result.summary.belowThresholdShare * 100,
          t('rangeBuffer.kpis.below', 'Below {{value}}%', { value: thresholdPct }),
          t('rangeBuffer.kpis.belowCount', '{{count}} included arrivals', { count: result.summary.belowThresholdCount })),
        percent('latest', result.summary.latestArrivalPct, t('rangeBuffer.kpis.latest', 'Latest arrival'),
          t('rangeBuffer.kpis.latestHint', 'newest included completion')),
        score('evidence-support', t('rangeBuffer.kpis.support', 'Evidence support')),
      ],
    },
    context: {
      id: 'range-buffer-drive-context',
      title: t('rangeBuffer.context.title', 'Drive-use context and field coverage'),
      description: t('rangeBuffer.context.subtitle', 'Start SoC, drive-associated SoC drop, and positive SI distance are secondary coverage fields; they do not decide arrival inclusion.'),
      metrics: [
        count('start-coverage', context.startSocRows, t('rangeBuffer.context.startCoverage', 'Valid start SoC'),
          t('rangeBuffer.context.ofIncluded', 'of {{count}} included arrivals', { count: accounting.includedRows }), contextResolved),
        percent('median-start', context.medianStartPct, t('rangeBuffer.context.medianStart', 'Median start SoC'),
          t('rangeBuffer.context.validStartsOnly', 'valid start-SoC rows only'), contextResolved),
        percent('median-drop', context.medianDropPct, t('rangeBuffer.context.medianDrop', 'Median drive-associated drop'),
          t('rangeBuffer.context.nonnegativeOnly', 'nonnegative start-to-end rows'), contextResolved),
        percent('p90-drop', context.p90DropPct, t('rangeBuffer.context.p90Drop', 'Observed p90 drop'),
          t('rangeBuffer.context.depletionRows', '{{count}} depletion-eligible rows', { count: context.depletionRows }), contextResolved),
        count('distance-coverage', context.distanceRows, t('rangeBuffer.context.distanceCoverage', 'Positive distance'),
          t('rangeBuffer.context.ofIncluded', 'of {{count}} included arrivals', { count: accounting.includedRows }), contextResolved),
        {
          metricId: 'distance', occurrenceId: 'median-distance',
          rawValue: contextResolved ? context.medianDistanceM : null,
          label: t('rangeBuffer.context.medianDistance', 'Median drive distance'),
          description: t('rangeBuffer.context.distanceRowsOnly', 'positive finite distance rows'),
          display: { formatter: (raw: number) => ({ value: formatDistance(raw), unit: '' }) },
        },
      ],
    },
    support: {
      id: 'range-buffer-evidence-support',
      title: t('rangeBuffer.support.title', 'Evidence support and coverage'),
      description: t('rangeBuffer.support.subtitle', 'Support measures returned sample breadth and recency; it is separate from whether arrival SoC is high or low.'),
      metrics: [
        score('support-index', t('rangeBuffer.support.index', 'Support index')),
        count('samples', accounting.includedRows, t('rangeBuffer.support.samples', 'Included arrivals'),
          t('rangeBuffer.support.sampleTarget', '50-row volume target')),
        count('active-days', result.coverage.activeLocalDays, t('rangeBuffer.support.days', 'Active local days'),
          t('rangeBuffer.support.dayTarget', '20-day breadth target')),
        count('active-weeks', result.coverage.activeLocalWeeks, t('rangeBuffer.support.weeks', 'Active local weeks'),
          t('rangeBuffer.support.weekTarget', '8-week breadth target')),
        {
          metricId: 'duration', occurrenceId: 'recency',
          rawValue: resolved && result.coverage.daysSinceLastObservation != null ? result.coverage.daysSinceLastObservation * 86400 : null,
          label: t('rangeBuffer.support.recency', 'Recency'),
          description: t('rangeBuffer.support.sinceLatest', 'since latest included arrival'),
          display: { formatter: (raw: number) => ({ value: t('rangeBuffer.support.daysValue', '{{value}} days', {
            value: rangeBufferNumber(raw / 86400, locale),
          }), unit: '' }) },
        },
        percent('repeated-destinations', result.destinationCoverage.repeatedCoverage == null ? null : result.destinationCoverage.repeatedCoverage * 100,
          t('rangeBuffer.support.destinationCoverage', 'Repeated-destination coverage'),
          t('rangeBuffer.support.supportedDestinations', '{{count}} supported destinations', { count: result.destinationCoverage.supportedDestinations })),
      ],
    },
    accounting: {
      id: 'range-buffer-accounting',
      title: t('rangeBuffer.accounting.title', 'Row accounting and secondary coverage'),
      description: t('rangeBuffer.accounting.subtitle', 'Every returned row enters exactly one primary category; optional context fields are counted separately.'),
      metrics: [
        count('returned', accounting.returnedRows, t('rangeBuffer.accounting.returned', 'Returned'),
          t('rangeBuffer.accounting.cap', '{{limit}}-row request cap', { limit: accounting.historyLimit })),
        count('included', accounting.includedRows, t('rangeBuffer.accounting.included', 'Included'),
          t('rangeBuffer.accounting.validArrival', 'valid completed arrival evidence')),
        count('incomplete', accounting.incompleteRows, t('rangeBuffer.accounting.incomplete', 'Incomplete'),
          t('rangeBuffer.accounting.noEnd', 'no completion timestamp')),
        count('invalid-time', accounting.invalidTimestampOrOrderRows, t('rangeBuffer.accounting.invalidTime', 'Invalid time or order'),
          t('rangeBuffer.accounting.badTime', 'unparseable or end before start')),
        count('future', accounting.futureRows, t('rangeBuffer.accounting.future', 'Future-dated'),
          t('rangeBuffer.accounting.afterClock', 'completion after frozen analysis clock')),
        count('invalid-arrival', accounting.invalidArrivalRows, t('rangeBuffer.accounting.invalidArrival', 'Invalid arrival SoC'),
          t('rangeBuffer.accounting.outOfRange', 'missing, non-finite, or outside 0-100')),
        count('positive-distance', context.distanceRows, t('rangeBuffer.accounting.distance', 'Positive distance'),
          t('rangeBuffer.accounting.secondary', 'secondary context coverage')),
        count('locatable', result.destinationCoverage.locatableRows, t('rangeBuffer.accounting.locatable', 'Locatable endpoint'),
          t('rangeBuffer.accounting.secondary', 'secondary context coverage')),
      ],
    },
  } satisfies Record<string, { id: string; title: string; description: string; metrics: readonly StatMetric[] }>;
  const band = bands[kind];
  return (
    <section data-testid={band.id} aria-label={kind === 'arrivals'
      ? t('rangeBuffer.kpis.aria', 'Observed arrival buffer evidence summary') : undefined}>
      <DrivingSummaryBrief
        id={`${band.id}-brief`}
        title={band.title}
        description={band.description}
        metrics={band.metrics}
        scope={scope}
        provenance={t('rangeBuffer.brief.provenance', 'Returned vehicle drives in the selected window, capped at 1,000 rows; vehicle-local time and frozen analysis clock.')}
        loading={state.isLoading}
        unavailable={!resolved}
        retained={state.refreshError != null}
        actions={kind === 'arrivals' ? <Select
          id="range-buffer-threshold" size="sm" className="min-w-36"
          label={t('rangeBuffer.threshold.label', 'Planning threshold')}
          aria-label={t('rangeBuffer.threshold.aria', 'Arrival battery planning threshold')}
          options={RANGE_BUFFER_THRESHOLDS.map((value) => ({
            value: String(value), label: t('rangeBuffer.threshold.option', 'Below {{value}}%', { value }),
          }))}
          value={String(thresholdPct)}
          onChange={(event) => onThresholdChange(Number(event.target.value))}
        /> : undefined}
      />
      {kind === 'arrivals' ? <RangeBufferQueryStatus result={result} state={state} /> : (
        <RangeBufferSectionBody result={result} state={state} requirement={kind === 'context' ? undefined : 'none'}>
          {kind === 'context' && <AlertBanner className="mt-4" variant="info">
            <Text as="p" variant="caption">{t('rangeBuffer.context.exclusions',
              '{{invalidStart}} included rows lack usable start SoC; {{increasing}} rows ended above their valid start SoC and are excluded only from depletion summaries.',
              { invalidStart: context.invalidStartSocRows, increasing: context.increasingSocRows })}</Text>
          </AlertBanner>}
          {kind === 'accounting' && <AlertBanner className="mt-4" variant="info">
            <Text as="p" variant="caption">{t('rangeBuffer.accounting.invariant',
              '{{returned}} returned = {{included}} included + {{incomplete}} incomplete + {{invalidTime}} invalid time/order + {{future}} future-dated + {{invalidArrival}} invalid arrival SoC.',
              { returned: accounting.returnedRows, included: accounting.includedRows, incomplete: accounting.incompleteRows,
                invalidTime: accounting.invalidTimestampOrOrderRows, future: accounting.futureRows, invalidArrival: accounting.invalidArrivalRows })}</Text>
          </AlertBanner>}
          {kind === 'support' && <>
            <AlertBanner className="mt-4" variant="info">
              <Text as="p" variant="caption">{t('rangeBuffer.support.formula',
                'Support index = 100 x (0.35 x sample volume + 0.25 x active days + 0.25 x active weeks + 0.15 x recency). Volume ingredients saturate at 50 arrivals, 20 days, and 8 weeks; recency scores 1 through 7 days, 0.75 through 30, 0.5 through 90, 0.25 through 180, then 0. Bands are thin below 35, developing below 70, and strong from 70.')}</Text>
            </AlertBanner>
            {result.coverage.omittedTrendMonths > 0 && <AlertBanner className="mt-3" variant="warning">
              <Text as="p" variant="caption">{t('rangeBuffer.support.monthLimit',
                '{{shown}} of {{returned}} returned local months are shown in the trend; the oldest {{omitted}} are omitted from that chart only.',
                { shown: result.coverage.displayedTrendMonths, returned: result.coverage.returnedTrendMonths, omitted: result.coverage.omittedTrendMonths })}</Text>
            </AlertBanner>}
          </>}
        </RangeBufferSectionBody>
      )}
    </section>
  );
}
