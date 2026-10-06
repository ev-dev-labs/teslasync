import { ListOrdered } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { LayoutCard } from '@/components/layout';
import { StatStrip } from '@/components/data-display';
import { Badge, Table, Text } from '@/components/ui';
import { CarbonSectionBody } from './CarbonSectionBody';
import type { CarbonIntensityBand } from '../../lib/carbonIntelligence';
import type { CarbonSectionProps } from './types';

function bandPresentation(
  band: CarbonIntensityBand,
  t: ReturnType<typeof useTranslation>['t'],
): {
  label: string;
  variant: 'success' | 'warning' | 'danger' | 'neutral';
} {
  if (band === 'clean') {
    return {
      label: t('carbon.directory.clean', 'Clean band'),
      variant: 'success',
    };
  }
  if (band === 'dirty') {
    return {
      label: t('carbon.directory.dirty', 'Dirty band'),
      variant: 'danger',
    };
  }
  if (band === 'flat') {
    return {
      label: t('carbon.directory.flat', 'Flat curve'),
      variant: 'neutral',
    };
  }
  return {
    label: t('carbon.directory.middle', 'Middle band'),
    variant: 'warning',
  };
}

export function CarbonHourlyDirectory({
  analysis,
  states,
  display,
}: CarbonSectionProps) {
  const { t } = useTranslation();
  const stats = analysis.curve.stats;

  return (
    <section
      data-testid="carbon-hourly-directory"
      aria-label={t(
        'carbon.directory.aria',
        'Ranked backend model clock-hour intensity directory',
      )}
    >
      <LayoutCard
        title={t('carbon.directory.title', 'Ranked hourly directory and bands')}
        actions={<ListOrdered className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />}
      >
        <Text as="p" variant="caption" className="mb-4">
          {stats.spanGPerKwh === 0
            ? t(
              'carbon.directory.flatRule',
              'The curve is flat, so clean and dirty labels are withheld.',
            )
            : t(
              'carbon.directory.bandRule',
              'Bands split the observed min-to-max span into broad thirds; they are descriptive, not precision forecasts.',
            )}
        </Text>
        <CarbonSectionBody state={states.intensity}>
          <StatStrip
            id="carbon-curve-statistics"
            variant="embedded"
            period={{ kind: 'unknown', label: t('carbon.source.intensityScope', 'Built-in, admin-editable static 24-hour model') }}
            metrics={[
              {
                label: t('carbon.directory.minimum', 'Minimum'),
                value: display.formatIntensity(stats.minGPerKwh),
              },
              {
                label: t('carbon.directory.maximum', 'Maximum'),
                value: display.formatIntensity(stats.maxGPerKwh),
              },
              {
                label: t('carbon.directory.mean', 'Mean'),
                value: display.formatIntensity(stats.meanGPerKwh),
              },
              {
                label: t('carbon.directory.median', 'Median'),
                value: display.formatIntensity(stats.medianGPerKwh),
              },
              {
                label: t('carbon.directory.span', 'Observed span'),
                value: display.formatIntensity(stats.spanGPerKwh),
              },
            ].map((metric, index) => ({
              metricId: 'text',
              occurrenceId: `carbon-curve-statistic-${index}`,
              label: metric.label,
              rawValue: metric.value,
            }))}
          />
          <Table aria-label={t('carbon.directory.title', 'Ranked hourly directory and bands')}>
            <tbody>
            {analysis.curve.rankedRows.map((row) => {
              const band = bandPresentation(row.band, t);
              return (
                <tr
                  key={row.hour}
                >
                  <th scope="row">
                    <Text as="p" variant="label">
                      {t('carbon.directory.rank', 'Rank {{rank}} · {{hour}}', {
                        rank: row.rank,
                        hour: display.formatHour(row.hour),
                      })}
                    </Text>
                  </th>
                  <td className="text-right"><Text as="p" variant="caption" mono>
                      {display.formatIntensity(row.intensityGPerKwh)}
                    </Text></td>
                  <td><Badge variant={band.variant}>{band.label}</Badge></td>
                </tr>
              );
            })}
            </tbody>
          </Table>
        </CarbonSectionBody>
      </LayoutCard>
    </section>
  );
}
