import type { ChargingSession } from '@/api/types';
import { useTranslation } from 'react-i18next';
import { type StatMetric } from '@/components/data-display/stat-reference';
import { ChargingSummaryBrief } from '../operationalbrief-all/ChargingSummaryBrief';
import { HelpTooltip } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useUnits } from '@/hooks/useUnits';
import { convertDurationFromSI, convertEnergyFromSI } from '@/lib/unitConversion';
import { formatDate } from '@/lib/dateFormat';
import type { StatPeriod } from '@/lib/metric-reference';

export interface DetailSessionStatsProps {
  session: ChargingSession;
  energy: number;
  duration: number;
  vehicleEnergy: number;
  billedEnergy: number | null;
  cost: number | null;
  billedCost: number | null;
  costText: string;
  configuredRate: number | null;
  calculatedRate: number | null;
  rateText: string;
  currencySymbol: string;
  distanceText: string;
  distanceM?: number | null;
  averageRate: number | null;
  retained: boolean;
}

/**
 * Numeric quantities bind to raw measurements; supplied specialist displays
 * preserve invoice denomination and range formatting. Only the compound SoC
 * interval remains text, never a number parsed from its label.
 */
export function DetailSessionStats({
  session, energy, duration, vehicleEnergy, billedEnergy, cost, billedCost,
  costText, configuredRate, calculatedRate, rateText, currencySymbol,
  distanceText, distanceM, averageRate, retained,
}: DetailSessionStatsProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { fmtNumber, precision, locale } = useNumberFormatting();
  const period: StatPeriod = {
    kind: 'event',
    eventId: String(session.id),
    start: session.started_at,
    end: session.ended_at,
    label: `${t('charging.detail.title', 'Charge Session')} #${session.id} · ${formatDate(session.started_at)}`,
    provenance: t('charging.detail.resource', 'Charge session'),
  };
  const hasBilledEnergy = billedEnergy != null && billedEnergy > 0;
  const energyContext = (
    <>
      {hasBilledEnergy && vehicleEnergy > 0 && t('charging.detail.vehicleMeasured', {
        energy: fmtNumber(convertEnergyFromSI(vehicleEnergy, unitPrefs.energy)),
        unit: unitPrefs.energy,
        defaultValue: 'Vehicle measured {{energy}} {{unit}}',
      })}
      {hasBilledEnergy && (
        <HelpTooltip
          size="sm"
          i18nKey="charging.detail.billedEnergyHelp"
          defaultValue="Tesla Supercharger invoices meter energy at the cabinet. Vehicle telemetry is energy into the pack and is often a few percent lower."
          ariaLabel={t('metricCard.moreInfoAbout', 'More info about {{label}}', {
            label: t('charging.detail.energy', 'Energy'),
          })}
        />
      )}
    </>
  );
  const metrics: readonly StatMetric[] = [
    {
      metricId: 'energy', occurrenceId: 'jsx-17201', rawValue: energy,
      label: t('charging.detail.energy', 'Energy'),
      display: { precision, units: { energy: unitPrefs.energy, locale } },
      context: hasBilledEnergy ? energyContext : undefined,
    },
    {
      metricId: 'duration', occurrenceId: 'jsx-17203',
      rawValue: duration / convertDurationFromSI(1, 'min'),
      label: t('charging.detail.duration', 'Duration'),
      display: { precision, units: { duration: 'min', locale } },
    },
    {
      metricId: 'charge.peakPower', occurrenceId: 'jsx-17205',
      rawValue: session.peak_power_w ?? 0,
      label: t('charging.detail.peakPower', 'Peak Power'),
      display: { precision, units: { power: 'kW', locale } },
      // Preserve original zero fallback and fixed kW display; gauges share it.
      context: undefined,
    },
    {
      metricId: 'text', occurrenceId: 'jsx-17207',
      rawValue: `${fmtNumber(session.start_soc_pct ?? 0)}–${fmtNumber(session.end_soc_pct ?? 0)}%`,
      label: t('charging.detail.socRange', 'SoC Range'),
    },
    {
      metricId: 'currency', occurrenceId: 'jsx-17209',
      rawValue: cost ?? (energy > 0 && configuredRate != null ? energy / 1000 * configuredRate : null),
      display: { formatter: () => ({ value: costText, unit: '' }) },
      label: cost != null ? t('charging.detail.totalCost', 'Total Cost') : t('charging.detail.estCost', 'Est. Cost'),
      context: billedCost != null
        ? t('charging.detail.teslaInvoice', 'Tesla invoice')
        : session.cost_decimal == null && energy > 0 && configuredRate != null
          ? t('charging.detail.atRate', {
              currencySymbol, costPerKwh: configuredRate,
              defaultValue: 'at {{currencySymbol}}{{costPerKwh}}/kWh',
            })
          : undefined,
    },
    {
      metricId: 'currency', occurrenceId: 'jsx-17211', rawValue: calculatedRate ?? configuredRate,
      display: { formatter: () => ({ value: rateText, unit: '' }) },
      label: t('charging.detail.perKwh', 'Per kWh'),
      context: calculatedRate == null ? t('charging.detail.fromSettings', 'from settings') : undefined,
    },
    {
      metricId: 'distance', occurrenceId: 'jsx-17213', rawValue: distanceM,
      display: { formatter: () => ({ value: distanceText, unit: '' }) },
      label: t('charging.detail.milesAdded', 'Miles Added'),
    },
    {
      metricId: 'power', occurrenceId: 'jsx-17215',
      rawValue: averageRate != null ? averageRate * 1000 : null,
      display: { formatter: raw => ({ value: fmtNumber(raw / 1000), unit: 'kWh/h' }) },
      label: t('charging.detail.avgRate', 'kWh/h Avg'),
    },
  ];
  return (
    <section aria-label={t('charging.detail.kpis', 'Key metrics')}>
    <ChargingSummaryBrief
      id="charging-detail-metrics"
      testId="charging-detail-metrics"
      title={t('charging.detail.kpis', 'Key metrics')}
      metrics={metrics}
      period={period}
      retained={retained}
    />
    </section>
  );
}
