import { PhysicsEvidenceBrief } from '../operationalbrief-n-z/PhysicsEvidenceBrief';
import { Badge, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';

import { Evidence } from './Evidence';
import { type PhysicsPage, unknown } from './PhysicsPageShell';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export default function PhysicsRangeSection({ physics }: { physics: PhysicsPage }) {
  const { fmtNumber } = useNumberFormatting();
  const { report, t } = physics;
  const { formatDistance, formatEnergy } = useUnits();
  const range = report?.range;
  const distance = (value: number | null | undefined) => value == null ? unknown(t) : formatDistance(value);
  const known = [
    { label: t('teslaOnly.rated', 'Rated'), value: range?.rated_range_m },
    { label: t('teslaOnly.typical', 'Typical'), value: range?.est_range_m },
    { label: t('teslaOnly.ideal', 'Ideal'), value: range?.ideal_range_m },
  ].filter((row): row is { label: string; value: number } => row.value != null);
  const values = known.map((row) => row.value);
  const spread = values.length > 1 ? Math.max(...values) - Math.min(...values) : null;
  const relativeSpread = spread != null && range?.rated_range_m != null && range.rated_range_m > 0
    ? 100 * spread / range.rated_range_m : null;
  const pairs = known.flatMap((first, index) => known.slice(index + 1).map((second) => ({
    first, second, difference: first.value - second.value,
  })));
  return <>
    <Evidence title={physics.title} honesty={range?.honesty}>
      <PhysicsEvidenceBrief physics={physics} id="physics-range-summary" available={range != null}
        description={t('teslaOnly.rangeNote', 'Spread is the largest minus smallest available displayed estimate. It is not uncertainty calibrated against actual driving, and missing estimates are excluded. Energy remaining and Wh/km describe different measures; dividing them would invent an unvalidated true-range forecast.')}
        metrics={[
          { metricId: 'distance', occurrenceId: 'rated', label: t('teslaOnly.rated', 'Rated'), rawValue: range?.rated_range_m, display: { formatter: raw => ({ value: distance(raw), unit: '' }) } },
          { metricId: 'distance', occurrenceId: 'typical', label: t('teslaOnly.typical', 'Typical'), rawValue: range?.est_range_m, display: { formatter: raw => ({ value: distance(raw), unit: '' }) } },
          { metricId: 'distance', occurrenceId: 'ideal', label: t('teslaOnly.ideal', 'Ideal'), rawValue: range?.ideal_range_m, display: { formatter: raw => ({ value: distance(raw), unit: '' }) } },
          { metricId: 'energy', occurrenceId: 'energy', label: t('teslaOnly.energy', 'Energy remaining'), rawValue: range?.energy_remaining_wh, display: { formatter: raw => ({ value: formatEnergy(raw), unit: '' }) } },
          { metricId: 'distance', occurrenceId: 'spread', label: t('teslaOnly.estimateSpread', 'Estimate spread'), rawValue: spread, display: { formatter: raw => ({ value: distance(raw), unit: '' }) }, context: `${t('teslaOnly.estimateSpread', 'Estimate spread')}: ${distance(spread)}` },
          { metricId: 'count', occurrenceId: 'known', label: t('teslaOnly.rangeKnownLabel', 'Available estimates'), rawValue: range ? known.length : null, display: { countTotal: 3 }, context: t('teslaOnly.rangeKnown', 'Available estimates: {{count}} / 3', { count: known.length }) },
          { metricId: 'percent', occurrenceId: 'relative', label: t('teslaOnly.rangeRelativeLabel', 'Spread versus rated'), rawValue: relativeSpread, display: { formatter: raw => ({ value: `${fmtNumber(raw)}%`, unit: '' }) }, context: t('teslaOnly.rangeRelative', 'Spread versus rated: {{value}}', { value: relativeSpread == null ? unknown(t) : `${fmtNumber(relativeSpread)}%` }) },
          { metricId: 'status', occurrenceId: 'disagreement', label: t('teslaOnly.rangeDisagreementLabel', 'Estimator disagreement'), rawValue: range == null ? null : range.disagree ? t('teslaOnly.estimatesDiffer', 'Estimates differ') : t('teslaOnly.noDetectedDifference', 'No detected difference in available estimates') },
          { metricId: 'efficiency', occurrenceId: 'recent-efficiency', label: t('teslaOnly.rangeRecentEfficiency', 'Recent Wh/km'), rawValue: range?.recent_wh_per_km == null ? null : range.recent_wh_per_km / 1000, display: { formatter: raw => ({ value: fmtNumber(raw * 1000), unit: 'Wh/km' }) } },
        ]} />
      {known.map((row) => <div key={row.label} className="flex justify-between gap-3 rounded-lg border border-[var(--glass-border)] p-3">
        <Text as="span" variant="bodySm">{row.label}</Text><Text as="span" variant="bodySm">{distance(row.value)}</Text>
      </div>)}
      <Text as="p" variant="bodySm">{t('teslaOnly.noTrueRange', 'No true range. Recent Wh/km: {{value}}', { value: range?.recent_wh_per_km == null ? unknown(t) : fmtNumber(range.recent_wh_per_km) })}</Text>
      {range?.true_range_m != null && <Badge variant="warning" size="sm">{t('teslaOnly.trueRangeBug', 'true_range must stay empty')}</Badge>}
    </Evidence>
    <Evidence title={t('teslaOnly.rangePairs', 'Pairwise estimate comparisons')}>
      {pairs.length ? pairs.map(({ first, second, difference }) => <div key={`${first.label}-${second.label}`} className="rounded-lg border border-[var(--glass-border)] p-3">
        <Text as="p" variant="bodySm">{t('teslaOnly.rangePairReading', '{{first}} vs {{second}}: {{distance}} apart', {
          first: first.label, second: second.label, distance: distance(Math.abs(difference)),
        })}</Text>
        <Text as="p" variant="caption">{t('teslaOnly.rangePairDirection', '{{higher}} is higher in the returned estimates', {
          higher: difference >= 0 ? first.label : second.label,
        })}</Text>
        <Text as="p" variant="caption">{t('teslaOnly.rangePairRelative', 'Difference relative to {{baseline}}: {{value}}', {
          baseline: first.label,
          value: first.value > 0 ? `${fmtNumber(100 * Math.abs(difference) / first.value)}%` : unknown(t),
        })}</Text>
      </div>) : <Text as="p" variant="bodySm">{t('teslaOnly.rangeInsufficient', 'At least two estimates are needed for a comparison. Missing estimates cannot be replaced by energy remaining.')}</Text>}
      <Text as="p" variant="caption">{t('teslaOnly.rangeSnapshot', 'These values are a returned snapshot without a calibrated error distribution or actual distance-to-empty observation. A difference does not identify a faulty estimator.')}</Text>
    </Evidence>
  </>;
}
