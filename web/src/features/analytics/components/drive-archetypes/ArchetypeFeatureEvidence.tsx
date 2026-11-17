import { SlidersHorizontal, Thermometer } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { LayoutCard } from '@/components/layout';
import {
  Badge,
  MetricLabel,
  Table,
  Text,
} from '@/components/ui';

import { ArchetypeSectionBody } from './ArchetypeSectionBody';
import type {
  ArchetypeDisplay,
  ArchetypeSectionProps,
} from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface ArchetypeFeatureEvidenceProps extends ArchetypeSectionProps {
  display: ArchetypeDisplay;
}

export function ArchetypeFeatureEvidence({
  summary,
  state,
  display,
}: ArchetypeFeatureEvidenceProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const minimumLabel = t('archetypes.features.minimum', 'Minimum');
  const medianLabel = t('archetypes.features.median', 'Median');
  const maximumLabel = t('archetypes.features.maximum', 'Maximum');
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
      format: (value: number | null | undefined) => display.formatEfficiency(value),
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
      <LayoutCard
        title={t('archetypes.features.title', 'Feature ranges and temperature-imputation evidence')}
        actions={(
          <>
            <SlidersHorizontal className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            <Badge variant="info">
              {state.isResolved && !state.error
                ? t('archetypes.features.activeBadge', '{{count}} of 6 active', { count: summary.activeFeatureDimensions })
                : t('archetypes.kpis.awaiting', 'Awaiting drive evidence')}
            </Badge>
          </>
        )}
      >
        <Text as="p" variant="caption" className="mt-1">
          {t('archetypes.features.subtitle', 'Eligible-row minimum, median, and maximum values at the display boundary.')}
        </Text>
        <ArchetypeSectionBody summary={summary} state={state} requirement="eligible">
          <Table className="min-w-[620px]" data-mobile-stack-table aria-label={t('archetypes.features.title', 'Feature ranges and temperature-imputation evidence')}>

            <thead data-app-part="table-head"><tr data-app-part="table-row">
              <th data-app-part="table-cell" scope="col"><MetricLabel>{t('archetypes.features.feature', 'Feature')}</MetricLabel></th>
              <th data-app-part="table-cell" scope="col" className="text-right"><MetricLabel>{minimumLabel}</MetricLabel></th>
              <th data-app-part="table-cell" scope="col" className="text-right"><MetricLabel>{medianLabel}</MetricLabel></th>
              <th data-app-part="table-cell" scope="col" className="text-right"><MetricLabel>{maximumLabel}</MetricLabel></th>
            </tr></thead>
            <tbody>
            {rows.map((row) => (
              <tr data-app-part="table-row"
                key={row.label}
              >
                <th data-app-part="table-cell" scope="row"><Text variant="label">{row.label}</Text></th>
                <td data-app-part="table-cell" data-mobile-label={minimumLabel} className="text-right"><Text variant="bodySm">{row.format(row.range.min)}</Text></td>
                <td data-app-part="table-cell" data-mobile-label={medianLabel} className="text-right"><Text variant="bodySm">{row.format(row.range.median)}</Text></td>
                <td data-app-part="table-cell" data-mobile-label={maximumLabel} className="text-right"><Text variant="bodySm">{row.format(row.range.max)}</Text></td>
              </tr>
            ))}
            </tbody>
          </Table>
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
      </LayoutCard>
    </section>
  );
}
