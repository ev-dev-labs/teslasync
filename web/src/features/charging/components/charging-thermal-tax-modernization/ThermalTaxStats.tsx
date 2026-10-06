import { useTranslation } from 'react-i18next';
import { Flame, Gauge, Timer, Zap } from 'lucide-react';
import { Badge, Button, Text } from '@/components/ui';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import { type StatMetric, type StatPeriod } from '@/components/data-display/stat-reference';
import { ChargingSummaryBrief } from '../operationalbrief-all/ChargingSummaryBrief';
import { formatDurationSecondsAsMinutes } from '@/lib/dateFormat';
import type { DataState } from '@/api/dataState';
import type { ChargingSession } from '@/types/charging';
import type { ChargingThermalTaxSummary, ThermalTaxSample } from '../../lib/chargingThermalTax';
import { heaterEvidence } from './thermalPresentation';

interface ThermalTaxStatsProps {
  session: ChargingSession | null;
  selected: boolean;
  summary: ChargingThermalTaxSummary;
  samples: readonly ThermalTaxSample[];
  state: DataState<unknown>;
  loading: boolean;
}

export function ThermalTaxStats({ session, selected, summary, samples, state, loading }: ThermalTaxStatsProps) {
  const { t } = useTranslation();
  const evidence = heaterEvidence(samples);
  const hasIntegral = selected && evidence.hasIntegral;
  const missingReason = selected
    ? t('chargingThermalTax.metrics.missingHeater', 'Not enough recorded heater readings for this metric.')
    : t('chargingThermalTax.noSession', 'no session selected');
  const estimate = t('chargingThermalTax.metrics.estimated', 'Estimated from sampled heater power');
  const period: StatPeriod = session ? {
    kind: 'event',
    label: t('chargingThermalTax.metrics.period', 'Selected charging session'),
    eventId: session.id,
    start: session.started_at,
    end: session.ended_at ?? null,
    provenance: t('chargingThermalTax.metrics.provenance', 'Historical telemetry; heater energy and on-time are derived, not directly metered.'),
  } : {
    kind: 'unknown',
    label: t('chargingThermalTax.metrics.period', 'Selected charging session'),
    reason: t('chargingThermalTax.noSelectionShort', 'No session selected.'),
  };
  const metrics: StatMetric[] = [
    {
      metricId: 'energy', occurrenceId: 'thermal-heater-energy',
      label: t('chargingThermalTax.heaterEnergy', 'Heater Energy'),
      rawValue: hasIntegral ? summary.heaterWh : null, missingReason,
      description: t('chargingThermalTax.heaterEnergyHint', 'trapezoidal integral over the session'),
      context: <span className="inline-flex flex-wrap items-center gap-1">
        <Flame className="h-4 w-4" aria-hidden="true" />{estimate}
      </span>,
    },
    {
      metricId: 'percent', occurrenceId: 'thermal-heater-share',
      label: t('chargingThermalTax.heaterShare', 'Heater Share'),
      rawValue: hasIntegral ? summary.heaterSharePct : null,
      missingReason: hasIntegral
        ? t('chargingThermalTax.metrics.missingDelivered', 'Delivered energy is unavailable or zero; heater share cannot be determined.')
        : missingReason,
      description: t('help.chargingThermalTax.heaterShare',
        'Heater energy divided by delivered input energy. Not the charging-curve power-vs-SoC view — this only measures heater overhead, independent of how fast the pack itself charged.'),
      context: <span className="inline-flex flex-wrap items-center gap-1">
        <Gauge className="h-4 w-4" aria-hidden="true" />
        {t('chargingThermalTax.heaterShareHint', 'of energy the charger delivered')}
        {hasIntegral && summary.heaterSharePct != null && summary.heaterSharePct >= 15 && (
          <Badge variant="warning" size="sm">
            {t('chargingThermalTax.metrics.highShare', 'Heater share ≥ 15%')}
          </Badge>
        )}
      </span>,
    },
    {
      metricId: 'duration', occurrenceId: 'thermal-heater-on-time',
      label: t('chargingThermalTax.heaterOnTime', 'Heater On Time'),
      rawValue: hasIntegral ? summary.heaterOnS : null, missingReason,
      display: { formatter: raw => ({ value: formatDurationSecondsAsMinutes(raw), unit: '' }) },
      description: t('chargingThermalTax.metrics.onTimeMethod', 'Intervals count as heater-on when average endpoint power exceeds 50 W.'),
      context: <span className="inline-flex flex-wrap items-center gap-1">
        <Timer className="h-4 w-4" aria-hidden="true" />
        {hasIntegral
          ? t('chargingThermalTax.heaterOnPct', '{{pct}}% of the session', { pct: summary.heaterOnPct })
          : selected ? missingReason : t('chargingThermalTax.noSession', 'no session selected')}
      </span>,
    },
    {
      metricId: 'power', occurrenceId: 'thermal-peak-heater',
      label: t('chargingThermalTax.peakHeater', 'Peak Heater Power'),
      rawValue: selected && evidence.hasPeak ? summary.peakHeaterW : null, missingReason,
      description: t('chargingThermalTax.peakHeaterHint', 'highest single reading'),
      context: <span className="inline-flex items-center gap-1">
        <Zap className="h-4 w-4" aria-hidden="true" />
        {t('chargingThermalTax.peakHeaterHint', 'highest single reading')}
      </span>,
    },
  ];

  return <ChargingSummaryBrief
    id="charging-thermal-tax-metrics"
    title={t('chargingThermalTax.kpis', 'Charging thermal tax metrics')}
    metrics={metrics}
    period={period}
    loading={loading}
    retained={selected && state.hasData && state.status === 'stale'}
    secondary={selected && evidence.incomplete ? (
      <Text as="p" variant="bodySm">
        {t('chargingThermalTax.metrics.incomplete',
          'Some heater readings are missing. Derived totals retain the existing zero-fill analysis and are incomplete estimates; missing readings do not mean no heater draw.')}
      </Text>
    ) : undefined}
    footer={selected ? <>
      <StaleRefreshWarning state={state} label={t('chargingThermalTax.telemetrySource', 'Session telemetry')} />
      {state.fatalError && <QueryError error={state.fatalError} onRetry={state.retry ?? undefined} />}
      {!state.hasData && state.isRefreshBlocked && <div className="space-y-2">
        <Text as="p" variant="bodySm">
          {t('chargingThermalTax.state.paused', 'Telemetry loading is paused. Connect to resume or retry.')}
        </Text>
        {state.retry && <Button variant="ghost" onClick={state.retry}>
          {t('common.retry', 'Retry')}
        </Button>}
      </div>}
    </> : undefined}
  />;
}
