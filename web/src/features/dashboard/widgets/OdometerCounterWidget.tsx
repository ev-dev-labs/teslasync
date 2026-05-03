import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, Calendar, TrendingUp } from 'lucide-react';
import { AnimatedNumber, MetricCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useDrivingStats } from '@/api/hooks/useDriving';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function OdometerCounterWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const idStr = id > 0 ? String(id) : undefined;

  const { data: stateData, isLoading: stateLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useVehicleState(id);
  const { data: stats, isLoading: statsLoading } = useDrivingStats(idStr);
  const { convertDistance, distanceUnit } = useSettings();

  const isCompact = size.cols === 1 && size.rows === 1;
  const isWide = size.cols >= 2;

  const odometer = stateData?.state?.odometer ?? null;
  const totalDistanceKm = stats?.totalDistanceKm ?? null;

  const convertedOdometer = useMemo(
    () => (odometer != null ? convertDistance(odometer) : null),
    [odometer, convertDistance],
  );
  const convertedTotalDriven = useMemo(
    () => (totalDistanceKm != null ? convertDistance(totalDistanceKm) : null),
    [totalDistanceKm, convertDistance],
  );

  const isLoading = stateLoading || statsLoading;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.odometer.title', 'Odometer')}
      icon={isCompact ? undefined : <Gauge className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {convertedOdometer != null ? (
        isCompact ? (
          <CompactView
            odometer={convertedOdometer}
            unit={distanceUnit}
          />
        ) : (
          <ExpandedView
            odometer={convertedOdometer}
            totalDriven={convertedTotalDriven}
            unit={distanceUnit}
            isWide={isWide}
          />
        )
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Gauge className="h-6 w-6" />}
          message={t('widget.odometer.noData', 'No odometer data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}

function CompactView({ odometer, unit }: { odometer: number; unit: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-1">
      <p className="text-2xl font-bold text-cyan-300 tabular-nums">
        <AnimatedNumber value={odometer} decimals={0} />
      </p>
      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{unit}</p>
    </div>
  );
}

function ExpandedView({
  odometer,
  totalDriven,
  unit,
  isWide,
}: {
  odometer: number;
  totalDriven: number | null;
  unit: string;
  isWide: boolean;
}) {
  const { t } = useTranslation('dashboard');

  return (
    <div className="h-full flex flex-col justify-center gap-3">
      {/* Primary odometer reading */}
      <div className="text-center">
        <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">
          {t('widget.odometer.total', 'Total Odometer')}
        </p>
        <p className="text-3xl font-bold text-cyan-300 tabular-nums">
          <AnimatedNumber value={odometer} decimals={0} suffix={` ${unit}`} />
        </p>
      </div>

      {/* Breakdown metrics — only when wide */}
      {isWide && (
        <div className="grid grid-cols-2 gap-2">
          <MetricCard
            label={t('widget.odometer.totalDriven', 'Total Driven')}
            value={totalDriven != null ? `${fmtNumber(totalDriven, 0)} ${unit}` : '—'}
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            color="green"
          />
          <MetricCard
            label={t('widget.odometer.unit', 'Unit')}
            value={unit}
            icon={<Calendar className="h-3.5 w-3.5" />}
            color="amber"
          />
        </div>
      )}
    </div>
  );
}
