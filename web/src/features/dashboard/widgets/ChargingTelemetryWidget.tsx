import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, Zap, BatteryCharging, Plug } from 'lucide-react';
import { Sparkline } from '@/components/charts';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { deriveDataState, knownNumber } from '@/api/dataState';
import { useChargingTelemetryLatest, useVehicles } from '@/api/hooks/useVehicles';

import { convertPowerFromSI } from '@/lib/unitConversion';
import { useUnits } from '@/hooks/useUnits';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid, type StatGridItem } from './shared';
import { dashboardTokens } from '../lib/dashboardTokens';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

const MAX_POWER_HISTORY = 30;

export default function ChargingTelemetryWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const query = useChargingTelemetryLatest(id, 5_000);
  const {
    data, isLoading, error,
    isFetching, isStale, isError, dataUpdatedAt, refetch,
  } = query;

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 4;

  const isCharging = data?.charging_state === 'Charging';

  // Accumulate a rolling power history for the sparkline
  const powerHistoryRef = useRef<number[]>([]);
  const lastTsRef = useRef<string | null>(null);
  const historyVehicleRef = useRef(id);
  if (historyVehicleRef.current !== id) {
    historyVehicleRef.current = id;
    powerHistoryRef.current = [];
    lastTsRef.current = null;
  }

  if (data && data.ts !== lastTsRef.current) {
    lastTsRef.current = data.ts;
    const pw = knownNumber(data.charger_power_w);
    if (pw != null) powerHistoryRef.current = [
      ...powerHistoryRef.current.slice(-(MAX_POWER_HISTORY - 1)),
      pw,
    ];
  }

  const voltage = knownNumber(data?.charger_voltage);
  const current = knownNumber(data?.charger_actual_current);
  const power = knownNumber(data?.charger_power_w);
  const phases = knownNumber(data?.charger_phases);

  // `charger_power_w` is SI watts. Convert to the user's power unit (kW) at the
  // render boundary — rendering the raw watt magnitude with a "kW" suffix was a
  // 1000× overstatement (an 11 kW charger showed as "11,000.0 kW").
  const powerDisplay = useMemo(
    () => power == null ? '—' : fmtNumber(convertPowerFromSI(power, unitPrefs.power)),
    [power, unitPrefs.power, fmtNumber],
  );

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  // Derive charger type from voltage/phases heuristic
  const chargerType = useMemo(() => {
    if (!data || !isCharging || voltage == null) return null;
    if (voltage > 300) return 'DC';
    return 'AC';
  }, [data, isCharging, voltage]);

  // Derive efficiency: actual power vs pilot capacity
  const efficiency = useMemo(() => {
    if (!data || !isCharging) return null;
    const pilot = knownNumber(data.charger_pilot_current);
    if (pilot == null || pilot <= 0 || voltage == null || voltage <= 0 || power == null || phases == null) return null;
    // Theoretical draw in WATTS (A × V × phases) so it matches the SI-watt
    // `power`; the previous kW divisor made the ratio 1000× too small and
    // pinned the result at the 100% clamp.
    const theoreticalPowerW = pilot * voltage * (phases > 0 ? phases : 1);
    if (theoreticalPowerW <= 0) return null;
    return Math.min(100, (power / theoreticalPowerW) * 100);
  }, [data, isCharging, voltage, phases, power]);

  const coreStats = useMemo((): StatGridItem[] => {
    if (!isCharging) return [];
    return [
      {
        label: t('widget.chargingTelemetry.voltage', 'Voltage'),
        value: voltage == null ? null : fmtNumber(voltage),
        unit: 'V',
        icon: <Zap className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.chargingTelemetry.current', 'Current'),
        value: current == null ? null : fmtNumber(current),
        unit: 'A',
        icon: <Gauge className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.chargingTelemetry.power', 'Power'),
        value: power == null ? null : powerDisplay,
        unit: unitPrefs.power,
        icon: <BatteryCharging className="h-3.5 w-3.5" />,
        valueColor: 'text-emerald-300',
      },
      {
        label: t('widget.chargingTelemetry.phases', 'Phases'),
        value: phases == null ? null : fmtInt(phases),
        icon: <Gauge className="h-3.5 w-3.5" />,
      },
    ];
  }, [isCharging, voltage, current, power, powerDisplay, unitPrefs.power, phases, t, fmtNumber, fmtInt]);

  // Wide-only extra stats
  const wideStats = useMemo((): StatGridItem[] => {
    if (!isCharging || !isWide) return [];
    const items: StatGridItem[] = [];
      items.push({
        label: t('widget.chargingTelemetry.efficiency', 'Efficiency'),
        value: efficiency == null ? null : fmtNumber(efficiency),
        unit: '%',
        icon: <Gauge className="h-3.5 w-3.5" />,
      });
    return items;
  }, [isCharging, isWide, efficiency, t, fmtNumber]);

  const allStats = useMemo(
    () => (isWide ? [...coreStats, ...wideStats] : coreStats),
    [isWide, coreStats, wideStats],
  );

  // ── Compact layout ──
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading && !data}
        dataState={data ? deriveDataState(query, { provenance: 'live' }) : undefined}
        error={isError && !data ? String(error ?? t('widget.chargingTelemetry.error', 'Unable to load charging telemetry')) : null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
      >
        {isCharging ? (
          <div className="h-full flex flex-col items-center justify-center gap-1 min-h-[44px]">
            <BatteryCharging className="h-5 w-5 text-emerald-300" />
            <WidgetBigNumber value={power == null ? null : `${powerDisplay} ${unitPrefs.power}`} align="center" size="secondary" animated={false} />
            <span className={dashboardTokens.metricLabel}>
              {voltage == null ? '—' : `${fmtNumber(voltage)}V`} · {current == null ? '—' : `${fmtNumber(current)}A`}
            </span>
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Plug className="h-5 w-5" />}
            message={data?.charging_state == null ? t('widget.noChargeData', 'No charge data') : t('widget.chargingTelemetry.notCharging', 'Not currently charging')}
            className="py-4"
          />
        )}
      </WidgetShell>
    );
  }

  // ── Standard / Wide layout ──
  return (
    <WidgetShell
      title={t('widget.chargingTelemetry.title', 'Charging telemetry')}
      icon={<Gauge className="h-3.5 w-3.5 text-emerald-300" />}
      loading={isLoading && !data}
      dataState={data ? deriveDataState(query, { provenance: 'live' }) : undefined}
      error={isError && !data ? String(error ?? t('widget.chargingTelemetry.error', 'Unable to load charging telemetry')) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {isCharging ? (
        <div className="flex flex-col gap-3 h-full">
          <WidgetStatGrid stats={allStats} cols={isWide ? 4 : 2} />

          {/* Wide extras: charger type badge + sparkline */}
          {isWide && (
            <div className="flex min-w-0 flex-wrap items-center gap-3 pt-2 border-t border-[var(--border-subtle)]">
              {chargerType && (
                <Badge variant={chargerType === 'DC' ? 'warning' : 'neutral'} size="sm">
                  {chargerType} {t('widget.chargingTelemetry.charger', 'charger')}
                </Badge>
              )}
              {powerHistoryRef.current.length > 1 && (
                <div className="flex-1 min-w-0">
                  <Sparkline
                    data={powerHistoryRef.current}
                    color="#22c55e"
                    height={28}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Plug className="h-5 w-5" />}
          message={data?.charging_state == null ? t('widget.noChargeData', 'No charge data') : t('widget.chargingTelemetry.notCharging', 'Not currently charging')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
