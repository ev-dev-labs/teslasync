import { useCallback, useMemo } from 'react';
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
  // Guard against a zero/negative max (division by zero → NaN dashoffset).
  const safeMax = max > 0 ? max : 100;
  const clamped = Math.max(0, Math.min(value, safeMax));
  const offset = circumference - (clamped / safeMax) * circumference;

  return (
    <div aria-hidden className="absolute inset-x-0 top-0 flex justify-center pointer-events-none">
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
  const { data: stateData, isLoading, isFetching, isStale, isError, error, dataUpdatedAt, refetch } = useVehicleState(id);
  const state = stateData?.state;

  const isCompact = size.cols === 1 && size.rows === 1;
  const isLarge = size.cols >= 2 && size.rows >= 2;

  const batteryLevel = state?.battery_level ?? 0;
  // charge_limit_soc may be present on extended state payloads. Validate it is
  // a finite number before use so a malformed field never leaks a NaN into the
  // gauge overlay or the stat row.
  const chargeLimitRaw = (state as Record<string, unknown> | undefined)?.charge_limit_soc;
  const chargeLimitSoc =
    typeof chargeLimitRaw === 'number' && Number.isFinite(chargeLimitRaw) ? chargeLimitRaw : undefined;

  const color = useMemo(() => (state ? getBatteryColor(batteryLevel) : '#374151'), [state, batteryLevel]);

  const gaugeSize = isCompact ? 70 : 100;

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

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
      // Surface a genuine initial-load failure (no state yet) as a real error
      // panel instead of the misleading "No battery data" empty state. When
      // cached state is present, a background-refetch error stays a subtle
      // freshness signal so we never blank out valid data.
      error={isError && !state ? String(error ?? t('widget.batteryError', 'Unable to load battery data')) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
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
              <p className="text-2xs text-emerald-300 animate-pulse mt-1">
                ⚡ {t('widget.charging', 'Charging')}
              </p>
            )}
          </>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Battery className="h-6 w-6" />}
            message={t('widget.noBattery', 'No battery data')}
            className="py-4"
          />
        )}
      </div>
    </WidgetShell>
  );
}
