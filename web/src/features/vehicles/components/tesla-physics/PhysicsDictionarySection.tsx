import { PhysicsEvidenceBrief } from '../operationalbrief-n-z/PhysicsEvidenceBrief';
import { Badge, Text } from '@/components/ui';
import { Evidence, RawRows } from './Evidence';
import { type PhysicsPage, seconds, unknown } from './PhysicsPageShell';

export default function PhysicsDictionarySection({ physics }: { physics: PhysicsPage }) {
  const { report, t } = physics;
  const dictionary = report?.dictionary;
  const dwells = (report?.vault?.etiquette_dwells_s ?? []).map((dwell, index) => ({ dwell, index }));
  const ranked = dwells.map((r) => r.dwell).filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  const median = ranked.length ? (ranked[Math.floor((ranked.length - 1) / 2)] + ranked[Math.floor(ranked.length / 2)]) / 2 : null;
  const difference = median != null && dictionary?.typical_complete_unplug_s != null
    ? Math.abs(median - dictionary.typical_complete_unplug_s) : null;
  const short = ranked.filter((value) => value <= 60).length;
  const medium = ranked.filter((value) => value > 60 && value <= 300).length;
  const long = ranked.filter((value) => value > 300).length;
  const lowerQuartile = ranked.length >= 4 ? ranked[Math.floor((ranked.length - 1) / 4)] : null;
  const upperQuartile = ranked.length >= 4 ? ranked[Math.ceil(3 * (ranked.length - 1) / 4)] : null;
  return <>
    <Evidence title={physics.title} honesty={dictionary?.honesty}>
      <PhysicsEvidenceBrief physics={physics} id="physics-dictionary-summary" available={dictionary != null}
        description={t('teslaOnly.dictionaryNote', 'Typical dwell is a median of observed Complete-to-Disconnected transitions, not a target or a penalty. Returned vault dwells may cover a different subset: compare rather than silently equate the two medians. No observed sample does not imply zero dwell.')}
        metrics={[
          { metricId: 'duration', occurrenceId: 'unplug', label: t('teslaOnly.unplug', 'Complete → unplug'), rawValue: dictionary?.typical_complete_unplug_s, display: { formatter: raw => ({ value: seconds(raw, t), unit: '' }) } },
          { metricId: 'duration', occurrenceId: 'park', label: t('teslaOnly.parkDwell', 'Park confirm dwell'), rawValue: dictionary?.park_confirm_dwell_s, display: { formatter: raw => ({ value: seconds(raw, t), unit: '' }) } },
          { metricId: 'count', occurrenceId: 'unscheduled', label: t('teslaOnly.unscheduled', 'Complete without schedule'), rawValue: dictionary?.complete_without_schedule },
          { metricId: 'count', occurrenceId: 'dwells', label: t('teslaOnly.dictionarySamplesLabel', 'Returned etiquette dwell observations'), rawValue: report?.vault ? dwells.length : null, context: t('teslaOnly.dictionarySamples', 'Returned etiquette dwell observations: {{count}}', { count: dwells.length }) },
          { metricId: 'duration', occurrenceId: 'median', label: t('teslaOnly.dictionaryMedianLabel', 'Returned dwell median'), rawValue: median, display: { formatter: raw => ({ value: seconds(raw, t), unit: '' }) }, context: t('teslaOnly.dictionaryMedian', 'Returned dwell median: {{value}}', { value: seconds(median, t) }) },
          { metricId: 'duration', occurrenceId: 'difference', label: t('teslaOnly.dictionaryDifferenceLabel', 'Median difference from dictionary'), rawValue: difference, display: { formatter: raw => ({ value: seconds(raw, t), unit: '' }) }, context: t('teslaOnly.dictionaryDifference', 'Median difference from dictionary: {{value}}', { value: seconds(difference, t) }) },
        ]} />
      <Text as="p" variant="bodySm">{t('teslaOnly.workbench.dwellBounds', 'Returned dwell bounds: {{shortest}} → {{longest}}', {
        shortest: ranked.length ? seconds(ranked[0], t) : unknown(t),
        longest: ranked.length ? seconds(ranked[ranked.length - 1], t) : unknown(t),
      })}</Text>
    </Evidence>
    <Evidence title={t('teslaOnly.dictionaryDistribution', 'Recorded etiquette dwell distribution')}>
      <PhysicsEvidenceBrief physics={physics} id="physics-dictionary-distribution" available={report?.vault != null}
        description={t('teslaOnly.dictionaryDistributionCaution', 'Counts describe the returned vault samples only. They may not be the source population for the dictionary median; without session timestamps they cannot establish trend or cause.')}
        metrics={[
          { metricId: 'count', occurrenceId: 'short', label: t('teslaOnly.dictionaryWithinMinute', 'At most one minute'), rawValue: report?.vault ? short : null },
          { metricId: 'count', occurrenceId: 'medium', label: t('teslaOnly.dictionaryOneToFive', 'Over one to five minutes'), rawValue: report?.vault ? medium : null },
          { metricId: 'count', occurrenceId: 'long', label: t('teslaOnly.dictionaryOverFive', 'Over five minutes'), rawValue: report?.vault ? long : null },
          { metricId: 'duration', occurrenceId: 'lower', label: t('teslaOnly.dictionaryLowerQuartile', 'Approximate lower quartile'), rawValue: lowerQuartile, display: { formatter: raw => ({ value: seconds(raw, t), unit: '' }) }, context: t('teslaOnly.dictionaryQuartileCaution', 'Quartiles are nearest returned observations, not a confidence interval. With fewer than four usable dwells the middle-half bounds stay unknown.') },
          { metricId: 'duration', occurrenceId: 'upper', label: t('teslaOnly.dictionaryUpperQuartile', 'Approximate upper quartile'), rawValue: upperQuartile, display: { formatter: raw => ({ value: seconds(raw, t), unit: '' }) } },
        ]} />
      {report?.vault ? <>
        {ranked.length === 0 && <Text as="p" variant="bodySm">{t('teslaOnly.dictionaryNoDwell', 'No usable dwell observations returned; a typical duration cannot be inferred from this list.')}</Text>}
        {ranked.length !== dwells.length && <Badge variant="warning" size="sm">{t('teslaOnly.dictionaryInvalidDwell', '{{count}} negative or non-finite dwell readings excluded from the distribution', { count: dwells.length - ranked.length })}</Badge>}
        <Text as="p" variant="bodySm">{t('teslaOnly.dictionaryMiddleHalf', 'Approximate middle-half dwell bounds (at least four samples): {{from}} → {{to}}', {
          from: seconds(lowerQuartile, t), to: seconds(upperQuartile, t),
        })}</Text>
        <Text as="p" variant="caption">{t('teslaOnly.dictionaryQuartileCaution', 'Quartiles are nearest returned observations, not a confidence interval. With fewer than four usable dwells the middle-half bounds stay unknown.')}</Text>
      </> : <Text as="p" variant="bodySm">{t('teslaOnly.dictionaryVaultUnavailable', 'Vault etiquette observations were not returned; dictionary statistics cannot be cross-checked against individual dwells.')}</Text>}
      <RawRows title={t('teslaOnly.vaultEtiquette', 'Supercharger etiquette dwells')} rows={dwells} t={t}
        tableId="physics:dictionary" keyExtractor={(r) => String(r.index)} columns={[
          { key: 'dwell', align: 'right', header: t('teslaOnly.unplug', 'Complete → unplug'), render: (r) => seconds(r.dwell, t) },
          { key: 'index', align: 'right', header: t('teslaOnly.dictionaryIndex', 'Returned observation'), render: (r) => r.index + 1 },
        ]} />
    </Evidence>
  </>;
}
