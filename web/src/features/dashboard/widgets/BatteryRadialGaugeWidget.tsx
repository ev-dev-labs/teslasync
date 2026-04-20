import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Battery } from 'lucide-react';
import { RadialGauge } from '@/components/charts';
import { AnimatedNumber } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
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
    <svg
      width={gaugeSize}
      height={gaugeSize}
      className="absolute inset-0 -rotate-90 pointer-events-none"
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
  );
}

export default function BatteryRadialGaugeWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: stateData, isLoading } = useVehicleState(id);
  const state = stateData?.state;

  const isCompact = size.cols === 1 && size.rows === 1;
  const isLarge = size.cols >= 2 && size.rows >= 2;

  const batteryLevel = state?.battery_level ?? 0;
  // charge_limit_soc may be present on extended state payloads
  const chargeLimitSoc = (state as Record<string, unknown> | undefined)?.charge_limit_soc as number | undefined;

  const color = useMemo(() => (state ? getBatteryColor(batteryLevel) : '#374151'), [state, batteryLevel]);

  const gaugeSize = isLarge ? 140 : isCompact ? 80 : 100;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.batteryRadial', 'Battery')}
      icon={isCompact ? undefined : <Battery className="h-3.5 w-3.5 text-white/40" />}
      loading={isLoading}
    >
      <div className="h-full flex flex-col items-center justify-center gap-1">
        {state ? (
          <>
            <div className="relative inline-flex items-center justify-center">
              <RadialGauge
                value={batteryLevel}
                max={100}
                label={isCompact ? '' : t('widget.battery', 'Battery')}
                unit="%"
                color={color}
                size={gaugeSize}
              />
              {chargeLimitSoc != null && (
                <ChargeLimitRing value={chargeLimitSoc} max={100} gaugeSize={gaugeSize} />
              )}
            </div>

            {isLarge && (
              <div className="flex items-center gap-4 mt-2">
                <div className="text-center">
                  <p className="text-[10px] text-white/40 uppercase tracking-wider">
                    {t('widget.level', 'Level')}
                  </p>
                  <AnimatedNumber
                    value={batteryLevel}
                    suffix="%"
                    className="text-lg font-bold text-white/90"
                  />
                </div>
                {chargeLimitSoc != null && (
                  <div className="text-center">
                    <p className="text-[10px] text-white/40 uppercase tracking-wider">
                      {t('widget.chargeLimit', 'Limit')}
                    </p>
                    <AnimatedNumber
                      value={chargeLimitSoc}
                      suffix="%"
                      className="text-lg font-bold text-white/50"
                    />
                  </div>
                )}
              </div>
            )}

            {state.is_charging && (
              <p className="text-[10px] text-neon-green animate-pulse mt-1">
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
