import { useTranslation } from 'react-i18next';
import { Database, HardDrive, Gauge, AlertTriangle, Car, Layers } from 'lucide-react';
import { StatCard } from '@/components/data-display';
import { QueryError } from '@/components/feedback';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { VehicleCostTotals } from '@/types/admin-operator-confidence';
import { avgRowsPerVehicle } from '../vehicle-cost/helpers';

export function VehicleCostSummary({ totals, vehicleCount, windowDays, loading, error, onRetry }: {
  totals: VehicleCostTotals | undefined; vehicleCount: number | null; windowDays: number;
  loading: boolean; error: unknown; onRetry: () => void;
}) {
  const { t } = useTranslation();
  const { fmtInt, formatBytes, fmtNumber } = useNumberFormatting();
  const integer = (value: number | null | undefined) => value == null ? '—' : fmtInt(value);
  const rows = totals?.total_rows;
  return (
    <section aria-label={t('admin.vehicleCost.kpiRegion', 'Fleet ingest totals')} className="space-y-3">
      {error != null && <QueryError error={error} onRetry={onRetry} />}
      <div className="grid min-w-0 grid-cols-2 gap-4 lg:grid-cols-3 3xl:grid-cols-6">
        <StatCard label={t('admin.vehicleCost.totalRows', 'Total rows')} value={integer(rows)}
          icon={<Database className="h-5 w-5" aria-hidden />} loading={loading}
          sublabel={t('admin.vehicleCost.windowSub', 'Window: {{days}}d', { days: windowDays })} />
        <StatCard label={t('admin.vehicleCost.totalBytes', 'Total bytes (est.)')}
          value={totals?.total_bytes_est == null ? '—' : formatBytes(totals.total_bytes_est)}
          icon={<HardDrive className="h-5 w-5" aria-hidden />} loading={loading}
          sublabel={t('admin.vehicleCost.bytesSub', '96 bytes/row average')} />
        <StatCard label={t('admin.vehicleCost.totalRate', 'Rate (rows/min, 24h)')}
          value={totals?.total_rate_per_minute_24h == null ? '—' : fmtNumber(totals.total_rate_per_minute_24h)}
          icon={<Gauge className="h-5 w-5" aria-hidden />} loading={loading}
          sublabel={t('admin.vehicleCost.rateSub', 'Across all vehicles')} />
        <StatCard label={t('admin.vehicleCost.totalFailures', 'DLQ failures (24h)')}
          value={integer(totals?.total_failures_24h)} icon={<AlertTriangle className="h-5 w-5" aria-hidden />} loading={loading}
          sublabel={t('admin.vehicleCost.failuresSub', 'Codec or writer rejections')} />
        <StatCard label={t('admin.vehicleCost.vehiclesTracked', 'Vehicles tracked')}
          value={integer(vehicleCount)} icon={<Car className="h-5 w-5" aria-hidden />} loading={loading}
          sublabel={t('admin.vehicleCost.vehiclesSub', 'Ingesting in window')} />
        <StatCard label={t('admin.vehicleCost.avgRows', 'Avg rows / vehicle')}
          value={rows == null || vehicleCount == null ? '—' : fmtInt(avgRowsPerVehicle(rows, vehicleCount))}
          icon={<Layers className="h-5 w-5" aria-hidden />} loading={loading}
          sublabel={t('admin.vehicleCost.avgSub', 'Fleet baseline')} />
      </div>
    </section>
  );
}
