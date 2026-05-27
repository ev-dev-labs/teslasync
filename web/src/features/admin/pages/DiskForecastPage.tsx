/**
 * Disk Forecast Page — Phase-45 admin observability surface.
 *
 * Per-hypertable disk usage with compressed/uncompressed split,
 * growth rate (bytes/day), and an estimate of days-to-quota when the
 * deployment configured `HYPERTABLE_QUOTA_BYTES`. Severity comes
 * straight from the backend so threshold tuning is a single Go ship.
 *
 * Backed by GET /api/v1/admin/observability/disk-forecast
 * (internal/handler/v1/admin_observability_handler.go).
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Database } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, DataTable, type Column } from '@/components/ui';
import { PanelTitle, Caption } from '@/components/ui/Typography';
import { StatCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { EmptyState, AlertBanner, SectionErrorBoundary } from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber, formatBytes } from '@/lib/numberFormat';
import { useDiskForecast } from '@/api/hooks/useOperatorConfidence';
import { isApiError } from '@/lib/resilience';
import type {
  DiskForecastSeverity,
  HypertableSize,
} from '@/types/admin-operator-confidence';

const SEVERITY_VARIANT: Record<DiskForecastSeverity, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ok: 'success',
  warn: 'warning',
  critical: 'danger',
  unknown: 'neutral',
};

const SEVERITY_LABEL: Record<DiskForecastSeverity, string> = {
  ok: 'OK',
  warn: 'Warn',
  critical: 'Critical',
  unknown: '—',
};

export default function DiskForecastPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.diskForecast.pageTitle', 'Disk Forecast'));

  const query = useDiskForecast();
  const subsystemMissing = isApiError(query.error) && query.error.status === 503;
  const rows = query.data?.hypertables ?? [];

  const fleetTotals = useMemo(() => {
    const total = rows.reduce((acc, r) => acc + r.total_bytes, 0);
    const uncompressed = rows.reduce((acc, r) => acc + r.uncompressed_bytes, 0);
    const compressed = rows.reduce((acc, r) => acc + r.compressed_bytes, 0);
    const growth = rows.reduce((acc, r) => acc + r.growth_bytes_per_day, 0);
    return { total, uncompressed, compressed, growth };
  }, [rows]);

  const columns = useMemo<Column<HypertableSize>[]>(
    () => [
      {
        key: 'hypertable',
        header: t('admin.diskForecast.colTable', 'Hypertable'),
        render: (r) => (
          <div className="flex flex-col">
            <span className="font-medium text-[var(--text-primary)]">{r.hypertable_name}</span>
            <Caption>
              {t('admin.diskForecast.chunkCount', '{{count}} chunks', {
                count: r.chunk_count,
              })}
            </Caption>
          </div>
        ),
      },
      {
        key: 'total',
        header: t('admin.diskForecast.colTotal', 'Total'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{formatBytes(r.total_bytes)}</span>,
      },
      {
        key: 'split',
        header: t('admin.diskForecast.colSplit', 'Uncompressed / compressed'),
        align: 'right',
        render: (r) => (
          <div className="text-right tabular-nums">
            <div>{formatBytes(r.uncompressed_bytes)}</div>
            <Caption>{formatBytes(r.compressed_bytes)} {t('admin.diskForecast.compressedSuffix', 'compressed')}</Caption>
          </div>
        ),
      },
      {
        key: 'growth',
        header: t('admin.diskForecast.colGrowth', 'Growth (per day)'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{formatBytes(r.growth_bytes_per_day)}/d</span>,
      },
      {
        key: 'days',
        header: t('admin.diskForecast.colDays', 'Days to quota'),
        align: 'right',
        render: (r) => (
          <span className="tabular-nums">
            {r.est_days_to_quota === null || r.est_days_to_quota === undefined
              ? '—'
              : fmtNumber(r.est_days_to_quota)}
          </span>
        ),
      },
      {
        key: 'severity',
        header: t('admin.diskForecast.colSeverity', 'Severity'),
        align: 'right',
        render: (r) => (
          <Badge variant={SEVERITY_VARIANT[r.severity] ?? 'neutral'}>
            {SEVERITY_LABEL[r.severity] ?? r.severity}
          </Badge>
        ),
      },
    ],
    [t],
  );

  return (
    <PageContainer
      title={t('admin.diskForecast.pageTitle', 'Disk Forecast')}
      subtitle={t(
        'admin.diskForecast.subtitle',
        'Per-hypertable disk usage with compressed/uncompressed split and days-to-quota estimate. Severity reflects the configured quota threshold.',
      )}
      query={query}
    >
      <FadeIn>
        <div className="space-y-6">
          {subsystemMissing && (
            <AlertBanner variant="warning" title={t('admin.subsystem.unavailableTitle', 'Subsystem unavailable')}>
              {t(
                'admin.diskForecast.notConfigured',
                'TimescaleDB hypertable metrics are unavailable on this deployment. This page requires TimescaleDB to be installed and accessible.',
              )}
            </AlertBanner>
          )}

          {rows.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label={t('admin.diskForecast.fleetTotal', 'Total disk')}
                value={formatBytes(fleetTotals.total)}
                sublabel={t('admin.diskForecast.tableCount', '{{count}} hypertables', { count: rows.length })}
              />
              <StatCard
                label={t('admin.diskForecast.fleetUncompressed', 'Uncompressed')}
                value={formatBytes(fleetTotals.uncompressed)}
                sublabel={
                  fleetTotals.total > 0
                    ? t('admin.diskForecast.percentSub', '{{pct}}% of total', {
                        pct: ((fleetTotals.uncompressed / fleetTotals.total) * 100).toFixed(1),
                      })
                    : '—'
                }
              />
              <StatCard
                label={t('admin.diskForecast.fleetCompressed', 'Compressed')}
                value={formatBytes(fleetTotals.compressed)}
                sublabel={
                  fleetTotals.total > 0
                    ? t('admin.diskForecast.percentSub', '{{pct}}% of total', {
                        pct: ((fleetTotals.compressed / fleetTotals.total) * 100).toFixed(1),
                      })
                    : '—'
                }
              />
              <StatCard
                label={t('admin.diskForecast.fleetGrowth', 'Growth (per day)')}
                value={`${formatBytes(fleetTotals.growth)}/d`}
                sublabel={t('admin.diskForecast.growthSub', 'Sum across all hypertables')}
              />
            </div>
          )}

          <GlassPanel className="p-6">
            <PanelTitle className="mb-4">{t('admin.diskForecast.tableTitle', 'Hypertables')}</PanelTitle>
            <SectionErrorBoundary name="disk-forecast-table">
              {rows.length === 0 && !query.isLoading && !subsystemMissing ? (
                // no-action: hypertable inventory is a TimescaleDB system state; users cannot create hypertables from the UI
                <EmptyState
                  icon={<Database className="h-8 w-8" />}
                  title={t('admin.diskForecast.emptyTitle', 'No hypertables')}
                  message={t(
                    'admin.diskForecast.emptyMessage',
                    'No hypertables found in this database. The disk forecast surfaces TimescaleDB hypertables only.',
                  )}
                />
              ) : (
                <DataTable
                  tableId="admin:disk-forecast"
                  columns={columns}
                  data={rows}
                  keyExtractor={(r) => r.hypertable_name}
                  emptyMessage={t('admin.diskForecast.emptyTable', 'No hypertables')}
                />
              )}
            </SectionErrorBoundary>
          </GlassPanel>
        </div>
      </FadeIn>
    </PageContainer>
  );
}
