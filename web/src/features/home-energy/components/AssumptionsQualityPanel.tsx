import { useTranslation } from 'react-i18next';
import { Sun, Home, Info } from 'lucide-react';
import { GlassPanel, PanelTitle, Badge, Caption } from '@/components/ui';
import { Grid } from '@/components/layout';
import type { ForecastQuality, ForecastResult } from '../lib/forecastAdapters';

interface AssumptionsQualityPanelProps {
  solarForecast: ForecastResult;
  loadForecast: ForecastResult;
  hasEnergySite: boolean;
  siteName: string | null;
}

const QUALITY_VARIANT: Record<ForecastQuality, 'success' | 'info' | 'warning' | 'neutral'> = {
  high: 'success',
  medium: 'info',
  low: 'warning',
  none: 'neutral',
};

/** Forecast confidence/quality plus an explicit measured-vs-assumed data-provenance disclosure. */
export function AssumptionsQualityPanel({ solarForecast, loadForecast, hasEnergySite, siteName }: AssumptionsQualityPanelProps) {
  const { t } = useTranslation();

  const qualityLabel: Record<ForecastQuality, string> = {
    high: t('homeEnergy.quality.high', 'High'),
    medium: t('homeEnergy.quality.medium', 'Medium'),
    low: t('homeEnergy.quality.low', 'Low'),
    none: t('homeEnergy.quality.none', 'No history'),
  };

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3">{t('homeEnergy.quality.title', 'Assumptions & Forecast Quality')}</PanelTitle>

      <Grid cols={{ default: 1, sm: 2 }} gap={4} className="mb-4">
        <div className="rounded-lg border border-[var(--border-subtle)] p-3">
          <div className="mb-1 flex items-center gap-2">
            <Sun className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-medium text-[var(--text-primary)]">{t('homeEnergy.quality.solar', 'Solar forecast')}</span>
            <Badge variant={QUALITY_VARIANT[solarForecast.quality]} size="sm">
              {qualityLabel[solarForecast.quality]}
            </Badge>
          </div>
          <Caption>
            {t('homeEnergy.quality.confidence', '{{pct}}% confidence from {{count}} history sample(s)', {
              pct: Math.round(solarForecast.confidence * 100),
              count: solarForecast.sourceSampleCount,
            })}
          </Caption>
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] p-3">
          <div className="mb-1 flex items-center gap-2">
            <Home className="h-4 w-4 text-cyan-400" />
            <span className="text-sm font-medium text-[var(--text-primary)]">{t('homeEnergy.quality.load', 'Household load forecast')}</span>
            <Badge variant={QUALITY_VARIANT[loadForecast.quality]} size="sm">
              {qualityLabel[loadForecast.quality]}
            </Badge>
          </div>
          <Caption>
            {t('homeEnergy.quality.confidence', '{{pct}}% confidence from {{count}} history sample(s)', {
              pct: Math.round(loadForecast.confidence * 100),
              count: loadForecast.sourceSampleCount,
            })}
          </Caption>
        </div>
      </Grid>

      <div className="flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 text-xs text-[var(--text-muted)]">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <p>
            {hasEnergySite
              ? t('homeEnergy.quality.provenanceSite', 'Measured: current vehicle SoC and solar/load history from {{site}}.', {
                  site: siteName ?? t('homeEnergy.quality.unnamedSite', 'your Tesla energy site'),
                })
              : t('homeEnergy.quality.provenanceNoSite', 'Measured: current vehicle state of charge only — no Tesla energy site was found on this account.')}
          </p>
          <p>
            {t(
              'homeEnergy.quality.provenanceAssumed',
              'Assumed (user-editable): tariff rates, grid/panel import-export limits, Powerwall specification, and per-vehicle target SoC, capacity, charge power, and departure time. TeslaSync has no endpoint that reports these as measured fact.',
            )}
          </p>
          <p className="font-medium text-[var(--text-secondary)]">
            {t('homeEnergy.quality.noAutonomy', 'This plan is a recommendation only. TeslaSync never issues a command to a vehicle, Powerwall, or utility as a result of it.')}
          </p>
        </div>
      </div>
    </GlassPanel>
  );
}
