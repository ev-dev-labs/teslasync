import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { Badge, Text } from '@/components/ui';
import { Evidence, RawRows } from '../components/tesla-physics/Evidence';
import { PhysicsPageShell, seconds, unknown, usePhysicsPage } from '../components/tesla-physics/PhysicsPageShell';

export default function PhysicsDictionaryPage() {
  const physics = usePhysicsPage('dictionary');
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
  return <PhysicsPageShell physics={physics}>
    <Evidence title={physics.title} honesty={dictionary?.honesty}>
      <Grid cols={{ default: 1, md: 3 }} gap={3}>
        <MetricCard label={t('teslaOnly.unplug', 'Complete → unplug')} value={seconds(dictionary?.typical_complete_unplug_s, t)} color="amber" />
        <MetricCard label={t('teslaOnly.parkDwell', 'Park confirm dwell')} value={seconds(dictionary?.park_confirm_dwell_s, t)} color="cyan" />
        <MetricCard label={t('teslaOnly.unscheduled', 'Complete without schedule')} value={dictionary?.complete_without_schedule ?? unknown(t)} color="purple" />
      </Grid>
      <div className="flex flex-wrap gap-2">
        <Badge variant="neutral" size="sm">{t('teslaOnly.dictionarySamples', 'Returned etiquette dwell observations: {{count}}', { count: dwells.length })}</Badge>
        <Badge variant="neutral" size="sm">{t('teslaOnly.dictionaryMedian', 'Returned dwell median: {{value}}', { value: seconds(median, t) })}</Badge>
        <Badge variant="neutral" size="sm">{t('teslaOnly.dictionaryDifference', 'Median difference from dictionary: {{value}}', { value: seconds(difference, t) })}</Badge>
      </div>
      <Text as="p" variant="bodySm">{t('teslaOnly.workbench.dwellBounds', 'Returned dwell bounds: {{shortest}} → {{longest}}', {
        shortest: ranked.length ? seconds(ranked[0], t) : unknown(t),
        longest: ranked.length ? seconds(ranked[ranked.length - 1], t) : unknown(t),
      })}</Text>
      <Text as="p" variant="caption">{t('teslaOnly.dictionaryNote', 'Typical dwell is a median of observed Complete-to-Disconnected transitions, not a target or a penalty. Returned Vault dwells may cover a different subset: compare rather than silently equate the two medians. No observed sample does not imply zero dwell.')}</Text>
    </Evidence>
    <Evidence title={t('teslaOnly.dictionaryDistribution', 'Recorded etiquette dwell distribution')}>
      {report?.vault ? <>
        <Grid cols={{ default: 1, md: 3 }} gap={3}>
          <MetricCard label={t('teslaOnly.dictionaryWithinMinute', 'At most one minute')} value={short} color="green" />
          <MetricCard label={t('teslaOnly.dictionaryOneToFive', 'Over one to five minutes')} value={medium} color="cyan" />
          <MetricCard label={t('teslaOnly.dictionaryOverFive', 'Over five minutes')} value={long} color="amber" />
        </Grid>
        {ranked.length === 0 && <Text as="p" variant="bodySm">{t('teslaOnly.dictionaryNoDwell', 'No usable dwell observations returned; a typical duration cannot be inferred from this list.')}</Text>}
        {ranked.length !== dwells.length && <Badge variant="warning" size="sm">{t('teslaOnly.dictionaryInvalidDwell', '{{count}} negative or non-finite dwell readings excluded from the distribution', { count: dwells.length - ranked.length })}</Badge>}
        <Text as="p" variant="bodySm">{t('teslaOnly.dictionaryMiddleHalf', 'Approximate middle-half dwell bounds (at least four samples): {{from}} → {{to}}', {
          from: seconds(lowerQuartile, t), to: seconds(upperQuartile, t),
        })}</Text>
        <Text as="p" variant="caption">{t('teslaOnly.dictionaryQuartileCaution', 'Quartiles are nearest returned observations, not a confidence interval. With fewer than four usable dwells the middle-half bounds stay unknown.')}</Text>
        <Text as="p" variant="caption">{t('teslaOnly.dictionaryDistributionCaution', 'Counts describe the returned Vault samples only. They may not be the source population for the Dictionary median; without session timestamps they cannot establish trend or cause.')}</Text>
      </> : <Text as="p" variant="bodySm">{t('teslaOnly.dictionaryVaultUnavailable', 'Vault etiquette observations were not returned; Dictionary statistics cannot be cross-checked against individual dwells.')}</Text>}
      <RawRows title={t('teslaOnly.vaultEtiquette', 'Supercharger etiquette dwells')} rows={dwells} t={t}
        tableId="physics:dictionary" keyExtractor={(r) => String(r.index)} columns={[
          { key: 'dwell', header: t('teslaOnly.unplug', 'Complete → unplug'), render: (r) => seconds(r.dwell, t) },
          { key: 'index', header: t('teslaOnly.dictionaryIndex', 'Returned observation'), render: (r) => r.index + 1 },
        ]} />
    </Evidence>
  </PhysicsPageShell>;
}
