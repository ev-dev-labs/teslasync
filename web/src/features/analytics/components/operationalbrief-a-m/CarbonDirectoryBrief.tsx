import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display';
import { Badge, Table, Text } from '@/components/ui';
import type { CarbonIntensityBand } from '../../lib/carbonIntelligence';
import type { CarbonSectionProps } from '../carbon-intelligence/types';
import { CarbonBriefBand } from './CarbonBriefBand';

function bandPresentation(band: CarbonIntensityBand, t: ReturnType<typeof useTranslation>['t']) {
  if (band === 'clean') return { label: t('carbon.directory.clean', 'Clean band'), variant: 'success' as const };
  if (band === 'dirty') return { label: t('carbon.directory.dirty', 'Dirty band'), variant: 'danger' as const };
  if (band === 'flat') return { label: t('carbon.directory.flat', 'Flat curve'), variant: 'neutral' as const };
  return { label: t('carbon.directory.middle', 'Middle band'), variant: 'warning' as const };
}

export function CarbonDirectoryBrief({ analysis, states, display }: CarbonSectionProps) {
  const { t } = useTranslation();
  const stats = analysis.curve.stats;
  const resolved = states.intensity.hasData;
  const values = [
    [t('carbon.directory.minimum', 'Minimum'), stats.minGPerKwh],
    [t('carbon.directory.maximum', 'Maximum'), stats.maxGPerKwh],
    [t('carbon.directory.mean', 'Mean'), stats.meanGPerKwh],
    [t('carbon.directory.median', 'Median'), stats.medianGPerKwh],
    [t('carbon.directory.span', 'Observed span'), stats.spanGPerKwh],
  ] as const;
  const metrics: StatMetric[] = values.map(([label, raw], index) => ({
    metricId: 'rate', occurrenceId: `carbon-curve-statistic-${index}`, label, rawValue: resolved ? raw : null,
    description: t('carbon.brief.intensityUnit', 'Source intensity in grams of CO₂ per kilowatt-hour.'),
    display: { formatter: value => ({ value: display.formatIntensity(value), unit: '' }) },
  }));
  const rule = stats.spanGPerKwh === 0
    ? t('carbon.directory.flatRule', 'The curve is flat, so clean and dirty labels are withheld.')
    : t('carbon.directory.bandRule', 'Bands split the observed min-to-max span into broad thirds; they are descriptive, not precision forecasts.');
  return <CarbonBriefBand testId="carbon-hourly-directory" metrics={metrics} state={states.intensity}
    title={t('carbon.directory.title', 'Ranked hourly directory and bands')} description={rule}
    scope={<span>{t('carbon.source.intensityScope', 'Built-in, admin-editable static 24-hour model')}</span>}>
    <Table aria-label={t('carbon.directory.title', 'Ranked hourly directory and bands')}>
      <tbody>{analysis.curve.rankedRows.map(row => {
        const band = bandPresentation(row.band, t);
        return <tr key={row.hour}>
          <th scope="row"><Text as="p" variant="label">{t('carbon.directory.rank', 'Rank {{rank}} · {{hour}}', {
            rank: row.rank, hour: display.formatHour(row.hour),
          })}</Text></th>
          <td className="text-right"><Text as="p" variant="caption" mono>{display.formatIntensity(row.intensityGPerKwh)}</Text></td>
          <td><Badge variant={band.variant}>{band.label}</Badge></td>
        </tr>;
      })}</tbody>
    </Table>
  </CarbonBriefBand>;
}
