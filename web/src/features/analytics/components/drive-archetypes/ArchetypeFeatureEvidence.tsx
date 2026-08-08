import { SlidersHorizontal, Thermometer } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import {
  Badge,
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import { ArchetypeSectionBody } from './ArchetypeSectionBody';
import type {
  ArchetypeDisplay,
  ArchetypeSectionProps,
} from './types';

interface ArchetypeFeatureEvidenceProps extends ArchetypeSectionProps {
  display: ArchetypeDisplay;
}

export function ArchetypeFeatureEvidence({
  summary,
  state,
  display,
}: ArchetypeFeatureEvidenceProps) {
  const { t } = useTranslation();
  const ranges = summary.featureRanges;
  const rows = [
    {
      label: t('archetypes.features.distance', 'Drive distance'),
      range: ranges.distanceM,
      format: display.formatDistance,
    },
    {
      label: t('archetypes.features.speed', 'Average speed'),
      range: ranges.speedMps,
      format: display.formatSpeed,
    },
    {
      label: t('archetypes.features.efficiency', 'Energy per distance'),
      range: ranges.efficiencyWhPerM,
      format: (value: number | null | undefined) => display.formatEfficiency(value, 1),
    },
    {
      label: t('archetypes.features.temperature', 'Outside temperature'),
      range: ranges.tempC,
      format: display.formatTemperature,
    },
  ];
  const imputed = summary.source.eligibleImputedTempRows;

  return (
    <section data-testid="drive-archetypes-feature-ranges">
      <GlassPanel className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <PanelTitle className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
              {t('archetypes.features.title', 'Feature ranges and temperature-imputation evidence')}
            </PanelTitle>
            <Text as="p" variant="caption" className="mt-1">
              {t(
                'archetypes.features.subtitle',
                'Eligible-row minimum, median, and maximum values at the display boundary.',
              )}
            </Text>
          </div>
          <Badge variant="info">
            {t('archetypes.features.activeBadge', '{{count}} of 6 active', {
              count: summary.activeFeatureDimensions,
            })}
          </Badge>
        </div>
        <ArchetypeSectionBody summary={summary} state={state} requirement="eligible">
          <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
            <div className="grid min-w-[620px] grid-cols-4 gap-3 bg-[var(--surface-2)] px-4 py-2">
              <MetricLabel>{t('archetypes.features.feature', 'Feature')}</MetricLabel>
              <MetricLabel>{t('archetypes.features.minimum', 'Minimum')}</MetricLabel>
              <MetricLabel>{t('archetypes.features.median', 'Median')}</MetricLabel>
              <MetricLabel>{t('archetypes.features.maximum', 'Maximum')}</MetricLabel>
            </div>
            {rows.map((row) => (
              <div
                key={row.label}
                className="grid min-w-[620px] grid-cols-4 gap-3 border-t border-[var(--border-subtle)] px-4 py-3"
              >
                <Text variant="label">{row.label}</Text>
                <Text variant="bodySm">{row.format(row.range.min)}</Text>
                <Text variant="bodySm">{row.format(row.range.median)}</Text>
                <Text variant="bodySm">{row.format(row.range.max)}</Text>
              </div>
            ))}
          </div>
          <AlertBanner
            className="mt-4"
            variant={imputed > 0 ? 'warning' : 'info'}
            icon={<Thermometer className="h-4 w-4" />}
          >
            {imputed > 0
              ? summary.temperatureImputationSource === 'observed_median'
                ? t(
                    'archetypes.features.imputationWarning',
                    '{{imputed}} eligible drives lacked measured temperature. Their clustering input uses the eligible measured-temperature median, {{temperature}}; this value is imputed, not measured.',
                    {
                      imputed: fmtInt(imputed),
                      temperature: display.formatTemperature(summary.temperatureImputationC),
                    },
                  )
                : t(
                    'archetypes.features.defaultImputationWarning',
                    '{{imputed}} eligible drives lacked measured temperature, and no eligible measured temperature exists. Their clustering input uses the configured default, {{temperature}}; this value is imputed, not measured.',
                    {
                      imputed: fmtInt(imputed),
                      temperature: display.formatTemperature(summary.temperatureImputationC),
                    },
                  )
              : t(
                  'archetypes.features.noImputation',
                  'All {{count}} eligible drives have measured outside temperature; no temperature value was imputed.',
                  { count: summary.source.eligibleObservedTempRows },
                )}
          </AlertBanner>
        </ArchetypeSectionBody>
      </GlassPanel>
    </section>
  );
}
