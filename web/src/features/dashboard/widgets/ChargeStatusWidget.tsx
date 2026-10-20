import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import type { StatMetric } from '@/components/data-display';
import { Badge } from '@/components/ui';
import { deriveDataState, knownNumber } from '@/api/dataState';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';

import { WidgetShell } from './WidgetShell';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export default function ChargeStatusWidget({ vehicleId }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const { data: vehicles } = vehiclesQuery;
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const query = useVehicleState(id);
  const { data: stateData, isLoading, isFetching, isStale, isError, error, dataUpdatedAt, refetch } = query;
  /* SI-floor: state.rated_range and state.charge_rate arrive in METERS / m·h⁻¹.
   * convertDistanceFromSI handles the meters→user-unit conversion. */
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const state = stateData?.state;
  const vehiclesState = deriveDataState(vehiclesQuery);
  const sourceState = deriveDataState({
    ...query,
    data: stateData ?? (isLoading || isError || error ? undefined : null),
  }, { provenance: stateData?.live ? 'live' : 'cached', unavailable: state == null });
  const dataState = id > 0 ? sourceState : vehiclesState;
  const batteryMetric: StatMetric = {
    metricId: 'percent', occurrenceId: 'charge-status-battery', rawValue: knownNumber(state?.battery_level),
    label: t('widget.battery', 'Battery'),
    description: t('widget.chargeStatusBatteryDescription', 'Returned battery percentage; a measured zero is not a missing reading.'),
    display: { formatter: raw => ({ value: fmtNumber(raw), unit: '%' }) },
  };
  const chargingMetrics: StatMetric[] = [
    // VehicleService exposes charger_power in kW, unlike canonical signal-store watts.
    { metricId: 'number', occurrenceId: 'charge-status-power', rawValue: knownNumber(state?.charger_power),
      label: t('widget.power', 'Power'),
      description: t('widget.chargeStatusPowerDescription', 'Returned charger power in the established kW API contract; no additional scaling is applied.'),
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: 'kW' }) } },
    { metricId: 'rate', occurrenceId: 'charge-status-rate', rawValue: knownNumber(state?.charge_rate),
      label: t('widget.rate', 'Rate'),
      description: t('widget.chargeStatusRateDescription', 'Meters of range added per hour, converted to the distance preference; this is not vehicle speed.'),
      display: { formatter: raw => ({ value: fmtNumber(convertDistanceFromSI(raw, distanceUnit)), unit: `${distanceUnit}/h` }) } },
    batteryMetric,
    { metricId: 'number', occurrenceId: 'charge-status-time-to-full', rawValue: knownNumber(state?.time_to_full_charge),
      label: t('widget.timeToFull', 'Time to full'),
      description: t('widget.chargeStatusTimeDescription', 'The existing hours display is retained; the wire unit is not independently established. Negative estimates remain unknown.'),
      display: { formatter: raw => ({ value: raw >= 0 ? `${fmtNumber(raw)}h` : '—', unit: '' }) } },
  ];
  const idleMetrics: StatMetric[] = [
    batteryMetric,
    { metricId: 'distance', occurrenceId: 'charge-status-range', rawValue: knownNumber(state?.rated_range),
      label: t('widget.range', 'Range'),
      description: t('widget.chargeStatusRangeDescription', 'Returned rated range in meters, converted only to the distance preference.'),
      display: { formatter: raw => ({ value: fmtNumber(convertDistanceFromSI(raw, distanceUnit)), unit: distanceUnit }) } },
  ];
  const scope = t('widget.chargeStatusSummaryScope', 'Vehicle {{id}} · returned state snapshot; not a completed charging session or continuous recording.', { id });

  return (
    <WidgetShell
      title={t('widget.chargeStatusLive', 'Charge status')}
      loading={isLoading && !stateData}
      error={!stateData && isError ? String(error ?? 'Request failed') : null}
      dataState={dataState}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => { if (id > 0) void refetch(); else void vehiclesQuery.refetch(); }}
    >
      <div className="h-full flex flex-col justify-center [&_[role=list]]:!grid-cols-1 @xs:[&_[role=list]]:!grid-cols-2">
        {state?.is_charging ? (
          <div className="min-w-0 space-y-3">
            <Badge variant="success" size="sm">{t('widget.charging', 'Charging')}</Badge>
            <DashboardSourceBrief metrics={chargingMetrics} state={dataState}
              eyebrow={t('widget.summaryEyebrow', 'Dashboard source summary')}
              title={t('widget.chargeStatusChargingSummaryTitle', 'Returned charging readings')}
              description={t('widget.chargeStatusChargingSummaryDescription', 'Power, range-addition rate, battery and time estimate remain separate source readings; missing values are not zero.')}
              scope={scope}
              testId="dashboard-charge-status-charging-brief" />
          </div>
        ) : state ? (
          <div className="min-w-0 space-y-3">
            <Badge variant="neutral" size="sm">
              {state.is_charging === false ? t('widget.notCharging', 'Not charging') : t('widget.chargingSchedule.modeUnknown', 'Unknown')}
            </Badge>
            <DashboardSourceBrief metrics={idleMetrics} state={dataState}
              eyebrow={t('widget.summaryEyebrow', 'Dashboard source summary')}
              title={t('widget.chargeStatusIdleSummaryTitle', 'Returned battery and range')}
              description={t('widget.chargeStatusIdleSummaryDescription', 'Battery and rated range remain visible for both idle and unknown charging status; the status badge does not establish source freshness.')}
              scope={scope}
              testId="dashboard-charge-status-idle-brief" />
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Zap className="h-5 w-5" />}
            message={t('widget.noChargeData', 'No charge data')}
            className="py-4"
          />
        )}
      </div>
    </WidgetShell>
  );
}
