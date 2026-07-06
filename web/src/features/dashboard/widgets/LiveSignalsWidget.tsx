import { useTranslation } from 'react-i18next';
import { Wifi, Cog, Thermometer, CircleDot } from 'lucide-react';
import { Badge } from '@/components/ui';
import { Skeleton, EmptyState } from '@/components/feedback';
import {
  useVehicles,
  useMotorLatest,
  useClimateLatest,
  useSecurityLatest,
  useLatestTirePressure,
} from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber, fmtInt, isFiniteNumber } from '@/lib/numberFormat';
import { cleanNil } from '@/lib/cleanNil';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertTempFromSI, convertPressureFromSI } from '@/lib/unitConversion';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-2xs text-[var(--text-secondary)]">{label}</span>
      <span className="text-xs font-bold text-[var(--text-primary)] truncate max-w-[100px]">
        {value}
      </span>
    </div>
  );
}

export default function LiveSignalsWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const opts = { enabled: id > 0, refetchInterval: 5_000 } as const;

  const { data: motor, isFetching: motorFetching, isStale: motorStale, isError: motorError, dataUpdatedAt: motorUpdatedAt, refetch: refetchMotor } = useMotorLatest(id, opts.refetchInterval);
  const { data: climate } = useClimateLatest(id, opts.refetchInterval);
  const { data: security } = useSecurityLatest(id, opts.refetchInterval);
  const { data: tires } = useLatestTirePressure(id, opts.refetchInterval);
  const { unitPrefs } = useUnits();
  const toTemperatureDisplay = (value: number) => convertTempFromSI(value, unitPrefs.temperature);

  const tempUnit = unitPrefs.temperature;
  const pressureUnit = unitPrefs.pressure;
  const toPressureDisplay = (value: number) => convertPressureFromSI(value, unitPrefs.pressure);

  const hasData = motor || climate || security || tires;

  return (
    <WidgetShell
      title={t('widget.liveSignals', 'Live Signals')}
      icon={<Wifi className="h-3.5 w-3.5 text-neon-cyan" />}
      updatedAt={motorUpdatedAt}
      isFetching={motorFetching}
      isStale={motorStale}
      isError={motorError}
      onRefresh={() => refetchMotor()}
    >
      {!hasData ? (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Wifi className="h-5 w-5" />}
          message={t('widget.noSignals', 'No live signal data')}
          className="py-4"
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 h-full overflow-y-auto">
          {/* Drivetrain */}
          <div className="space-y-1.5">
            <h4 className="text-2xs font-semibold uppercase text-[var(--text-muted)] flex items-center gap-1">
              <Cog className="h-3 w-3 text-purple-300" /> {t('widget.motor', 'Motor')}
            </h4>
            {motor ? (
              <>
                <Row
                  label={t('widget.torque', 'Torque')}
                  value={isFiniteNumber(motor.di_torque) ? `${fmtInt(motor.di_torque)} Nm` : '—'}
                />
                <Row
                  label={t('widget.motorTemp', 'Temp')}
                  value={
                    isFiniteNumber(motor.di_stator_temp)
                      ? `${fmtInt(toTemperatureDisplay(motor.di_stator_temp))}${tempUnit}`
                      : '—'
                  }
                />
                <Row label={t('widget.gear', 'Gear')} value={cleanNil(motor.gear) ?? '—'} />
              </>
            ) : (
              <Skeleton className="h-12" />
            )}
          </div>

          {/* Climate */}
          <div className="space-y-1.5">
            <h4 className="text-2xs font-semibold uppercase text-[var(--text-muted)] flex items-center gap-1">
              <Thermometer className="h-3 w-3 text-cyan-300" /> {t('widget.climate', 'Climate')}
            </h4>
            {climate ? (
              <>
                <Row
                  label={t('widget.cabin', 'Cabin')}
                  value={
                    isFiniteNumber(climate.inside_temp)
                      ? `${fmtInt(toTemperatureDisplay(climate.inside_temp))}${tempUnit}`
                      : '—'
                  }
                />
                <Row
                  label={t('widget.outside', 'Outside')}
                  value={
                    isFiniteNumber(climate.outside_temp)
                      ? `${fmtInt(toTemperatureDisplay(climate.outside_temp))}${tempUnit}`
                      : '—'
                  }
                />
                <Row
                  label={t('widget.hvac', 'HVAC')}
                  value={isFiniteNumber(climate.hvac_power) ? `${fmtNumber(climate.hvac_power, 1)} kW` : '—'}
                />
              </>
            ) : (
              <Skeleton className="h-12" />
            )}
          </div>

          {/* Tires */}
          <div className="space-y-1.5">
            <h4 className="text-2xs font-semibold uppercase text-[var(--text-muted)] flex items-center gap-1">
              <CircleDot className="h-3 w-3 text-cyan-300" /> {t('widget.tires', 'Tires')}
            </h4>
            {tires ? (
              <>
                <Row
                  label="FL"
                  value={
                    isFiniteNumber(tires.front_left)
                      ? `${fmtNumber(toPressureDisplay(tires.front_left), 1)} ${pressureUnit}`
                      : '—'
                  }
                />
                <Row
                  label="FR"
                  value={
                    isFiniteNumber(tires.front_right)
                      ? `${fmtNumber(toPressureDisplay(tires.front_right), 1)} ${pressureUnit}`
                      : '—'
                  }
                />
                <Row
                  label="RL"
                  value={
                    isFiniteNumber(tires.rear_left)
                      ? `${fmtNumber(toPressureDisplay(tires.rear_left), 1)} ${pressureUnit}`
                      : '—'
                  }
                />
                <Row
                  label="RR"
                  value={
                    isFiniteNumber(tires.rear_right)
                      ? `${fmtNumber(toPressureDisplay(tires.rear_right), 1)} ${pressureUnit}`
                      : '—'
                  }
                />
              </>
            ) : (
              <Skeleton className="h-12" />
            )}
          </div>

          {/* Security summary */}
          <div className="space-y-1.5">
            <h4 className="text-2xs font-semibold uppercase text-[var(--text-muted)] flex items-center gap-1">
              <span aria-hidden="true">🛡️</span> {t('widget.security', 'Security')}
            </h4>
            {security ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-2xs text-[var(--text-secondary)]">
                    {t('widget.lock', 'Lock')}
                  </span>
                  <Badge variant={security.locked ? 'success' : 'danger'}>
                    {security.locked ? t('widget.locked', 'Locked') : t('widget.unlocked', 'Unlocked')}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-2xs text-[var(--text-secondary)]">
                    {t('widget.sentry', 'Sentry')}
                  </span>
                  <Badge variant={security.sentry_mode ? 'success' : 'neutral'}>
                    {security.sentry_mode ? t('widget.active', 'Active') : t('widget.off', 'Off')}
                  </Badge>
                </div>
              </>
            ) : (
              <Skeleton className="h-12" />
            )}
          </div>
        </div>
      )}
    </WidgetShell>
  );
}
