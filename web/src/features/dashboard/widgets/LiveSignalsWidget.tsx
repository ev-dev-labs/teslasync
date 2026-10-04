import { useTranslation } from 'react-i18next';
import { Wifi, Cog, Thermometer, CircleDot } from 'lucide-react';
import { Badge } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import {
  useVehicles,
  useMotorLatest,
  useClimateLatest,
  useSecurityLatest,
  useLatestTirePressure,
} from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { resolveHvacActive } from '@/lib/climateState';
import { isFiniteNumber } from '@/lib/numberFormat';
import { cleanNil } from '@/lib/cleanNil';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertTempFromSI, convertPressureFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState, useCombinedDataState } from '@/hooks/useDataState';
import { dashboardTokens } from '../lib/dashboardTokens';
import type { DataStateSource } from '@/api/dataState';

function snapshotSource<T extends object | null>(query: DataStateSource<T>): DataStateSource<T> {
  return {
    ...query,
    data: (query.isError || query.error) && (!query.data || Object.keys(query.data).length === 0)
      ? undefined : query.data,
  };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
      <span className={dashboardTokens.metricLabel}>{label}</span>
      <span className={`${dashboardTokens.title} min-w-0 break-all tabular-nums`}>
        {value}
      </span>
    </div>
  );
}

export default function LiveSignalsWidget({ vehicleId }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const opts = { enabled: id > 0, refetchInterval: 5_000 } as const;

  const motorQuery = useMotorLatest(id, opts.refetchInterval);
  const climateQuery = useClimateLatest(id, opts.refetchInterval);
  const securityQuery = useSecurityLatest(id, opts.refetchInterval);
  const tiresQuery = useLatestTirePressure(id, opts.refetchInterval);
  const { data: motor } = motorQuery;
  const { data: climate } = climateQuery;
  const { data: security } = securityQuery;
  const { data: tires } = tiresQuery;
  const motorState = useDataState(snapshotSource(motorQuery));
  const climateState = useDataState(snapshotSource(climateQuery));
  const securityState = useDataState(snapshotSource(securityQuery));
  const tiresState = useDataState(snapshotSource(tiresQuery));
  const dataState = useCombinedDataState([motorState, climateState, securityState, tiresState]);
  const handleRefresh = () => {
    void motorQuery.refetch();
    void climateQuery.refetch();
    void securityQuery.refetch();
    void tiresQuery.refetch();
  };
  const { unitPrefs } = useUnits();
  const toTemperatureDisplay = (value: number) => convertTempFromSI(value, unitPrefs.temperature);

  const tempUnit = unitPrefs.temperature;
  const pressureUnit = unitPrefs.pressure;
  const toPressureDisplay = (value: number) => convertPressureFromSI(value, unitPrefs.pressure);

  const hasData = [motor, climate, security, tires].some((value) => value != null && Object.keys(value).length > 0);
  const climateHvacState = climate
    ? resolveHvacActive(climate.hvac_power, climate.is_ac_on)
    : null;

  return (
    <WidgetShell
      title={t('widget.liveSignals', 'Live signals')}
      icon={<Wifi className="h-3.5 w-3.5 text-neon-cyan" />}
      dataState={{
        ...dataState, retry: handleRefresh, data: motor ?? climate ?? security ?? tires, hasData: Boolean(hasData),
        fatalError: hasData ? null : motorState.fatalError ?? climateState.fatalError ?? securityState.fatalError ?? tiresState.fatalError,
      }}
      updatedAt={dataState.updatedAt ?? 0}
      isFetching={dataState.isRefreshing}
      isStale={dataState.status === 'stale'}
      isError={Boolean(dataState.refreshError || dataState.fatalError)}
      onRefresh={handleRefresh}
    >
      {!hasData ? (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Wifi className="h-5 w-5" />}
          message={t('widget.noSignals', 'No live signal data')}
          className="py-4"
        />
      ) : (
        <div className={`grid ${dashboardTokens.columns[2]} gap-4 h-full overflow-y-auto`}>
          {/* Drivetrain */}
          <div className="space-y-1.5">
            <h4 className={`${dashboardTokens.title} flex items-center gap-1`}>
              <Cog className="h-3 w-3 text-purple-300" /> {t('widget.motor', 'Motor')}
            </h4>
            {motor ? (
              <>
                <Row
                  label={t('widget.torque', 'Torque')}
                  value={isFiniteNumber(motor.di_torque) ? `${fmtNumber(motor.di_torque)} Nm` : '—'}
                />
                <Row
                  label={t('widget.motorTemp', 'Temp')}
                  value={
                    isFiniteNumber(motor.di_stator_temp)
                      ? `${fmtNumber(toTemperatureDisplay(motor.di_stator_temp))}${tempUnit}`
                      : '—'
                  }
                />
                <Row label={t('widget.gear', 'Gear')} value={cleanNil(motor.gear) ?? '—'} />
              </>
            ) : (
              motorState.fatalError ? <QueryError error={motorState.fatalError} onRetry={() => { void motorQuery.refetch(); }} /> : motorQuery.isLoading ? <Skeleton className="h-12" /> : <Row label={t('widget.motor', 'Motor')} value="—" />
            )}
          </div>

          {/* Climate */}
          <div className="space-y-1.5">
            <h4 className={`${dashboardTokens.title} flex items-center gap-1`}>
              <Thermometer className="h-3 w-3 text-cyan-300" /> {t('widget.climate', 'Climate')}
            </h4>
            {climate ? (
              <>
                <Row
                  label={t('widget.cabin', 'Cabin')}
                  value={
                    isFiniteNumber(climate.inside_temp)
                      ? `${fmtNumber(toTemperatureDisplay(climate.inside_temp))}${tempUnit}`
                      : '—'
                  }
                />
                <Row
                  label={t('widget.outside', 'Outside')}
                  value={
                    isFiniteNumber(climate.outside_temp)
                      ? `${fmtNumber(toTemperatureDisplay(climate.outside_temp))}${tempUnit}`
                      : '—'
                  }
                />
                <Row
                  label={t('widget.hvac', 'HVAC')}
                  value={climateHvacState == null
                    ? '—'
                    : climateHvacState
                      ? t('widget.hvacOn', 'On')
                      : t('widget.hvacOff', 'Off')}
                />
              </>
            ) : (
              climateState.fatalError ? <QueryError error={climateState.fatalError} onRetry={() => { void climateQuery.refetch(); }} /> : climateQuery.isLoading ? <Skeleton className="h-12" /> : <Row label={t('widget.climate', 'Climate')} value="—" />
            )}
          </div>

          {/* Tires */}
          <div className="space-y-1.5">
            <h4 className={`${dashboardTokens.title} flex items-center gap-1`}>
              <CircleDot className="h-3 w-3 text-cyan-300" /> {t('widget.tires', 'Tires')}
            </h4>
            {tires ? (
              <>
                <Row
                  label="FL"
                  value={
                    isFiniteNumber(tires.front_left)
                      ? `${fmtNumber(toPressureDisplay(tires.front_left))} ${pressureUnit}`
                      : '—'
                  }
                />
                <Row
                  label="FR"
                  value={
                    isFiniteNumber(tires.front_right)
                      ? `${fmtNumber(toPressureDisplay(tires.front_right))} ${pressureUnit}`
                      : '—'
                  }
                />
                <Row
                  label="RL"
                  value={
                    isFiniteNumber(tires.rear_left)
                      ? `${fmtNumber(toPressureDisplay(tires.rear_left))} ${pressureUnit}`
                      : '—'
                  }
                />
                <Row
                  label="RR"
                  value={
                    isFiniteNumber(tires.rear_right)
                      ? `${fmtNumber(toPressureDisplay(tires.rear_right))} ${pressureUnit}`
                      : '—'
                  }
                />
              </>
            ) : (
              tiresState.fatalError ? <QueryError error={tiresState.fatalError} onRetry={() => { void tiresQuery.refetch(); }} /> : tiresQuery.isLoading ? <Skeleton className="h-12" /> : <Row label={t('widget.tires', 'Tires')} value="—" />
            )}
          </div>

          {/* Security summary */}
          <div className="space-y-1.5">
            <h4 className={`${dashboardTokens.title} flex items-center gap-1`}>
              <span aria-hidden="true">🛡️</span> {t('widget.security', 'Security')}
            </h4>
            {security ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-2xs text-[var(--text-secondary)]">
                    {t('widget.lock', 'Lock')}
                  </span>
                  <Badge variant={typeof security.locked !== 'boolean' ? 'neutral' : security.locked ? 'success' : 'danger'}>
                    {typeof security.locked !== 'boolean' ? '—' : security.locked ? t('widget.locked', 'Locked') : t('widget.unlocked', 'Unlocked')}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-2xs text-[var(--text-secondary)]">
                    {t('widget.sentry', 'Sentry')}
                  </span>
                  <Badge variant={security.sentry_mode === true ? 'success' : 'neutral'}>
                    {typeof security.sentry_mode !== 'boolean' ? '—' : security.sentry_mode ? t('widget.active', 'Active') : t('widget.off', 'Off')}
                  </Badge>
                </div>
              </>
            ) : (
              securityState.fatalError ? <QueryError error={securityState.fatalError} onRetry={() => { void securityQuery.refetch(); }} /> : securityQuery.isLoading ? <Skeleton className="h-12" /> : <Row label={t('widget.security', 'Security')} value="—" />
            )}
          </div>
        </div>
      )}
    </WidgetShell>
  );
}
