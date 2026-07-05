/**
 * Fleet-total KPI band for the Vehicle Ingest Cost page.
 *
 * Renders the four backend totals (rows, bytes, ingest rate, DLQ failures)
 * plus two page-derived KPIs (vehicles tracked, average rows/vehicle) as a
 * full-width responsive `MetricCard` grid that reflows 2 → 3 → 6 columns.
 * Owns its own loading + error states so it never blanks the whole page.
 */
import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, HardDrive, Gauge, AlertTriangle, Car, Layers } from 'lucide-react';

import { GlassPanel } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, QueryError } from '@/components/feedback';
import { type NeonColor } from '@/lib/tokens';
import { fmtNumber, fmtInt, formatBytes } from '@/lib/numberFormat';
import { avgRowsPerVehicle, type SectionState } from './helpers';
import type { VehicleCostTotals } from '@/types/admin-operator-confidence';

interface FleetCostKpisProps extends SectionState {
  totals: VehicleCostTotals | undefined;
  vehicleCount: number;
  windowDays: number;
}

interface Kpi {
  key: string;
  label: string;
  value: string;
  icon: ReactNode;
  color: NeonColor;
  subtitle: string;
}

const GRID = 'grid grid-cols-2 gap-4 lg:grid-cols-3 3xl:grid-cols-6';

export function FleetCostKpis({
  totals,
  vehicleCount,
  windowDays,
  loading,
  error,
  onRetry,
}: FleetCostKpisProps) {
  const { t } = useTranslation();

  // Backend totals are operational counters (counts / bytes / rates); coerce
  // every optional field to a number up-front so the KPI band never renders
  // `NaN`/`undefined`, and derive the cards inside `useMemo` so the array (and
  // its icon nodes) stay referentially stable across background refetches.
  const rows = totals?.total_rows ?? 0;
  const bytes = totals?.total_bytes_est ?? 0;
  const rate = totals?.total_rate_per_minute_24h ?? 0;
  const failures = totals?.total_failures_24h ?? 0;

  const kpis = useMemo<Kpi[]>(
    () => [
      {
        key: 'rows',
        label: t('admin.vehicleCost.totalRows', 'Total rows'),
        // Row counts are integers — format at 0 dp via `fmtInt` so they never
        // inherit the user's fractional display precision (`fmtNumber`'s
        // default, e.g. rendering a count as "1,234,567.00").
        value: fmtInt(rows),
        icon: <Database className="h-5 w-5" />,
        color: 'cyan',
        subtitle: t('admin.vehicleCost.windowSub', 'Window: {{days}}d', { days: windowDays }),
      },
      {
        key: 'bytes',
        label: t('admin.vehicleCost.totalBytes', 'Total bytes (est.)'),
        value: formatBytes(bytes),
        icon: <HardDrive className="h-5 w-5" />,
        color: 'blue',
        subtitle: t('admin.vehicleCost.bytesSub', '96 bytes/row average'),
      },
      {
        key: 'rate',
        label: t('admin.vehicleCost.totalRate', 'Rate (rows/min, 24h)'),
        value: fmtNumber(rate, 1),
        icon: <Gauge className="h-5 w-5" />,
        color: 'green',
        subtitle: t('admin.vehicleCost.rateSub', 'Across all vehicles'),
      },
      {
        key: 'failures',
        label: t('admin.vehicleCost.totalFailures', 'DLQ failures (24h)'),
        value: fmtInt(failures),
        icon: <AlertTriangle className="h-5 w-5" />,
        color: failures > 0 ? 'red' : 'green',
        subtitle: t('admin.vehicleCost.failuresSub', 'Codec or writer rejections'),
      },
      {
        key: 'vehicles',
        label: t('admin.vehicleCost.vehiclesTracked', 'Vehicles tracked'),
        value: fmtInt(vehicleCount),
        icon: <Car className="h-5 w-5" />,
        color: 'purple',
        subtitle: t('admin.vehicleCost.vehiclesSub', 'Ingesting in window'),
      },
      {
        key: 'avg',
        label: t('admin.vehicleCost.avgRows', 'Avg rows / vehicle'),
        value: fmtInt(avgRowsPerVehicle(rows, vehicleCount)),
        icon: <Layers className="h-5 w-5" />,
        color: 'cyan',
        subtitle: t('admin.vehicleCost.avgSub', 'Fleet baseline'),
      },
    ],
    [t, rows, bytes, rate, failures, vehicleCount, windowDays],
  );

  if (error) {
    return (
      <GlassPanel className="p-4 sm:p-5">
        <QueryError error={error} onRetry={onRetry} />
      </GlassPanel>
    );
  }

  if (loading && !totals) {
    return (
      <div className={GRID} role="status" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} height={88} rounded className="rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <section aria-label={t('admin.vehicleCost.kpiRegion', 'Fleet ingest totals')} className={GRID}>
      {kpis.map((k) => (
        <MetricCard
          key={k.key}
          label={k.label}
          value={k.value}
          icon={k.icon}
          color={k.color}
          subtitle={k.subtitle}
        />
      ))}
    </section>
  );
}
