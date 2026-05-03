import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Battery } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import { WidgetGaugeHero, type GaugeHeroStat } from './shared';
import type { WidgetProps } from './types';

const STROKE_WIDTH = 8;

function getBatteryColor(level: number): string {
  if (level > 50) return '#10b981'; // green
  if (level > 20) return '#f59e0b'; // amber
  return '#ef4444';                 // red
}

/** Thin arc overlay showing the charge limit position on the gauge */
function ChargeLimitRing({ value, max, gaugeSize }: { value: number; max: number; gaugeSize: number }) {
  const radius = (gaugeSize - STROKE_WIDTH) / 2;
  const center = gaugeSize / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(value, max));
  const offset = circumference - (clamped / max) * circumference;

  return (
    <div className="absolute inset-x-0 top-0 flex justify-center pointer-events-none">
      <svg
        width={gaugeSize}
        height={gaugeSize}
        className="-rotate-90"
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.25)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
    </div>
  );
}

export default function BatteryRadialGaugeWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: stateData, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useVehicleState(id);
  const state = stateData?.state;

  const isCompact = size.cols === 1 && size.rows === 1;
  const isLarge = size.cols >= 2 && size.rows >= 2;

  const batteryLevel = state?.battery_level ?? 0;
  // charge_limit_soc may be present on extended state payloads
  const chargeLimitSoc = (state as Record<string, unknown> | undefined)?.charge_limit_soc as number | undefined;

  const color = useMemo(() => (state ? getBatteryColor(batteryLevel) : '#374151'), [state, batteryLevel]);

  const gaugeSize = isCompact ? 70 : 100;

  const stats = useMemo<GaugeHeroStat[]>(() => {
    const s: GaugeHeroStat[] = [
      { label: t('widget.level', 'Level'), value: batteryLevel, unit: '%' },
    ];
    if (chargeLimitSoc != null) {
      s.push({ label: t('widget.chargeLimit', 'Limit'), value: chargeLimitSoc, unit: '%' });
    }
    return s;
  }, [t, batteryLevel, chargeLimitSoc]);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.batteryRadial', 'Battery')}
      icon={isCompact ? undefined : <Battery className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      <div className="h-full flex flex-col items-center justify-center gap-1">
        {state ? (
          <>
            <div className="relative">
              <WidgetGaugeHero
                gauge={{
                  value: batteryLevel,
                  max: 100,
                  label: isCompact ? '' : t('widget.battery', 'Battery'),
                  unit: '%',
                  color,
                }}
                stats={isLarge ? stats : undefined}
                compact={isCompact}
              >
                {chargeLimitSoc != null && (
                  <ChargeLimitRing value={chargeLimitSoc} max={100} gaugeSize={gaugeSize} />
                )}
              </WidgetGaugeHero>
            </div>

            {state.is_charging && (
              <p className="text-[10px] text-emerald-300 animate-pulse mt-1">
                ⚡ {t('widget.charging', 'Charging')}
              </p>
            )}
          </>
        ) : (
          <EmptyState
            icon={<Battery className="h-6 w-6" />}
            message={t('widget.noBattery', 'No battery data')}
            className="py-4"
          />
        )}
      </div>
    </WidgetShell>
  );
}
