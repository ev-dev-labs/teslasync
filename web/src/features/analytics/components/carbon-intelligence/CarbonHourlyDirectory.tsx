import { ListOrdered } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, Badge, PanelTitle, Text } from '@/components/ui';
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
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-2 flex items-center gap-2">
          <ListOrdered
            className="h-4 w-4 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          {t('carbon.directory.title', 'Ranked hourly directory and bands')}
        </PanelTitle>
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
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
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
            ].map((metric) => (
              <div
                key={metric.label}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <Text as="p" variant="metricLabel">{metric.label}</Text>
                <Text as="p" variant="body" mono className="mt-1">
                  {metric.value}
                </Text>
              </div>
            ))}
          </div>
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {analysis.curve.rankedRows.map((row) => {
              const band = bandPresentation(row.band, t);
              return (
                <li
                  key={row.hour}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <div>
                    <Text as="p" variant="label">
                      {t('carbon.directory.rank', 'Rank {{rank}} · {{hour}}', {
                        rank: row.rank,
                        hour: display.formatHour(row.hour),
                      })}
                    </Text>
                    <Text as="p" variant="caption" mono>
                      {display.formatIntensity(row.intensityGPerKwh)}
                    </Text>
                  </div>
                  <Badge variant={band.variant}>{band.label}</Badge>
                </li>
              );
            })}
          </ol>
        </CarbonSectionBody>
      </GlassPanel>
    </section>
  );
}
