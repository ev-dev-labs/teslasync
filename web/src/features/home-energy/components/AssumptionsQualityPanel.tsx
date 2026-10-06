import { useTranslation } from 'react-i18next';
import { Sun, Home, Info } from 'lucide-react';
import { Badge, Text } from '@/components/ui';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import type { DataState } from '@/api/dataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { ForecastQuality, ForecastResult } from '../lib/forecastAdapters';

interface AssumptionsQualityPanelProps {
  solarForecast: ForecastResult;
  loadForecast: ForecastResult;
  hasEnergySite: boolean;
  siteName: string | null;
  historyState?: DataState<unknown>;
}

const QUALITY_VARIANT: Record<ForecastQuality, 'success' | 'info' | 'warning' | 'neutral'> = {
  high: 'success',
  medium: 'info',
  low: 'warning',
  none: 'neutral',
};

/** Forecast confidence/quality plus an explicit measured-vs-assumed data-provenance disclosure. */
export function AssumptionsQualityPanel({ solarForecast, loadForecast, hasEnergySite, siteName, historyState }: AssumptionsQualityPanelProps) {
  const { t } = useTranslation();

  const qualityLabel: Record<ForecastQuality, string> = {
    high: t('homeEnergy.quality.high', 'High'),
    medium: t('homeEnergy.quality.medium', 'Medium'),
    low: t('homeEnergy.quality.low', 'Low'),
    none: t('homeEnergy.quality.none', 'No history'),
  };
  const metrics: readonly StatMetric[] = [
    { occurrenceId: 'solar-confidence', forecast: solarForecast, icon: Sun,
      label: t('homeEnergy.quality.solar', 'Solar forecast') },
    { occurrenceId: 'load-confidence', forecast: loadForecast, icon: Home,
      label: t('homeEnergy.quality.load', 'Household load forecast') },
  ].map<StatMetric>(({ occurrenceId, forecast, icon: Icon, label }) => ({
    metricId: 'percent',
    occurrenceId,
    label,
    rawValue: forecast.confidence * 100,
    display: { formatter: raw => ({ value: String(Math.round(raw)), unit: '%' }) },
    description: t('homeEnergy.quality.confidence', '{{pct}}% confidence from {{count}} history sample(s)', {
      pct: Math.round(forecast.confidence * 100),
      count: forecast.sourceSampleCount,
    }),
    context: <>
      <span className="inline-flex items-center gap-2">
        <Icon className="h-4 w-4" aria-hidden="true" />
        <Badge variant={QUALITY_VARIANT[forecast.quality]} size="sm">{qualityLabel[forecast.quality]}</Badge>
      </span>
      <div>{forecast.latestSampleIso
        ? t('homeEnergy.quality.latestSample', 'Latest source history sample: {{time}}', { time: forecast.latestSampleIso })
        : t('homeEnergy.quality.noSampleTime', 'No source history sample timestamp is available.')}</div>
    </>,
  }));
  const operationalMetrics = useOperationalMetrics(metrics);
  const loading = historyState?.status === 'initial';
  const statusLabel = loading
    ? t('homeEnergy.brief.loading', 'Loading source inputs')
    : historyState?.isRefreshBlocked
      ? t('homeEnergy.brief.paused', 'Source refresh paused')
      : historyState?.status === 'stale'
        ? t('homeEnergy.brief.retained', 'Retained source inputs')
        : historyState?.status === 'initialFailure' || historyState?.status === 'partial'
          ? t('homeEnergy.brief.partial', 'Incomplete source inputs')
          : solarForecast.quality === 'none' && loadForecast.quality === 'none'
            ? t('homeEnergy.quality.none', 'No history')
            : t('homeEnergy.quality.historyQuality', 'History-derived forecast quality');

  return (
    <div className="space-y-4">
      <OperationalBrief compact testId="home-energy-forecast-quality" metrics={operationalMetrics} loading={loading}
        eyebrow={t('homeEnergy.quality.eyebrow', 'Forecast evidence')}
        title={t('homeEnergy.quality.title', 'Assumptions & forecast quality')}
        description={t('homeEnergy.quality.briefDescription', 'Review the separate solar and household-load history behind this modeled recommendation. Confidence applies to forecasts only.')}
        statusLabel={statusLabel}
        statusTone={historyState?.isRefreshBlocked || historyState?.status === 'stale'
          || historyState?.status === 'initialFailure' || historyState?.status === 'partial' ? 'warning' : 'neutral'}
        scope={t('homeEnergy.quality.coverageUnknown', 'Historical sample coverage is not established; solar and load evidence remain separate.')}
        provenance={t('homeEnergy.quality.historyProvenance', 'Forecast-adapter confidence is derived from available energy history, not confidence in measured vehicle or battery state.')}
      />

      <div className="flex min-w-0 items-start gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <Text as="p" variant="caption">
            {hasEnergySite
              ? t('homeEnergy.quality.availableSiteInputs', 'Source inputs when available: vehicle SoC and solar/load history from {{site}}.', {
                  site: siteName ?? t('homeEnergy.quality.unnamedSite', 'your Tesla energy site'),
                })
              : t('homeEnergy.quality.availableVehicleInputs', 'Source inputs when available: vehicle state of charge — no Tesla energy site was found on this account.')}
          </Text>
          <Text as="p" variant="caption">
            {t('homeEnergy.quality.missingSourceInputs', 'Missing vehicle or home-battery SoC uses a 50% model assumption, not a measurement. Forecast confidence above describes the history actually available.')}
          </Text>
          <Text as="p" variant="caption">
            {t(
              'homeEnergy.quality.provenanceAssumed',
              'Assumed (user-editable): tariff rates, grid/panel import-export limits, Powerwall specification, and per-vehicle target SoC, capacity, charge power, and departure time. TeslaSync has no endpoint that reports these as measured fact.',
            )}
          </Text>
          <Text as="p" variant="caption" weight="medium" color="secondary">
            {t('homeEnergy.quality.noAutonomy', 'This plan is a recommendation only. TeslaSync never issues a command to a vehicle, Powerwall, or utility as a result of it.')}
          </Text>
        </div>
      </div>
    </div>
  );
}
