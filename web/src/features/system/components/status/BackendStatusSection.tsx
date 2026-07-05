import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Server, Database, Activity, Clock, Gauge } from 'lucide-react';
import { Grid } from '@/components/layout';
import { Badge, DataTable, type Column } from '@/components/ui';
import { StatCard, KVList } from '@/components/data-display';
import { Skeleton, AlertBanner } from '@/components/feedback';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { formatDateTime } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import { useConnectionPool } from '@/api/hooks/useAdmin';
import { getExtendedHealth, getVersionInfo } from '@/api/devtools';
import { AccordionSection } from './AccordionSection';
import { getStatusIcon, statusTextClass, formatUptime } from './helpers';

interface ComponentRow {
  name: string;
  status: string;
  latency_ms: number;
  failures: number;
  lastCheck: string;
}

export function BackendStatusSection() {
  const { t } = useTranslation();

  const { data: extHealth, isLoading: extLoading, isError: extError } = useQuery({
    queryKey: ['system-status', 'extended-health'],
    queryFn: getExtendedHealth,
    refetchInterval: 30_000,
  });

  const { data: pool, isLoading: poolLoading } = useConnectionPool();

  const { data: version } = useQuery({
    queryKey: ['system-status', 'version'],
    queryFn: getVersionInfo,
    refetchInterval: 60_000,
  });

  const isLoading = extLoading || poolLoading;

  const componentRows: ComponentRow[] = useMemo(
    () =>
      extHealth
        ? Object.entries(extHealth.components ?? {}).map(([name, c]) => ({
            name,
            status: c.status ?? 'unknown',
            latency_ms: c.latency_ms ?? 0,
            failures: c.consecutive_failures ?? 0,
            lastCheck: c.last_check ?? '',
          }))
        : [],
    [extHealth],
  );

  const componentColumns: Column<ComponentRow>[] = useMemo(
    () => [
      {
        key: 'status',
        header: t('Status'),
        render: (row) => (
          <div className="flex items-center gap-2">
            {getStatusIcon(row.status)}
            <span className={statusTextClass(row.status)}>{row.status}</span>
          </div>
        ),
      },
      {
        key: 'name',
        header: t('Component'),
        sortable: true,
        render: (row) => <span className="font-medium text-[var(--text-primary)]">{row.name}</span>,
      },
      {
        key: 'latency_ms',
        header: t('Latency'),
        sortable: true,
        render: (row) => `${fmtNumber(row.latency_ms, 1)} ms`,
      },
      {
        key: 'failures',
        header: t('Failures'),
        sortable: true,
        render: (row) => <span className={cn(row.failures > 0 && 'text-red-400')}>{fmtInt(row.failures)}</span>,
      },
      {
        key: 'lastCheck',
        header: t('Last Check'),
        render: (row) => (row.lastCheck ? formatDateTime(row.lastCheck) : '—'),
      },
    ],
    [t],
  );

  const okCount = useMemo(
    () => componentRows.filter((r) => r.status === 'ok' || r.status === 'healthy').length,
    [componentRows],
  );

  return (
    <AccordionSection
      icon={<Server className="h-5 w-5" />}
      title={t('Backend Status')}
      description={t('Component health, database pool, and runtime info')}
      badges={
        componentRows.length > 0 ? (
          <Badge variant={okCount === componentRows.length ? 'success' : 'warning'} size="sm">
            {okCount}/{componentRows.length} {t('healthy')}
          </Badge>
        ) : undefined
      }
      defaultOpen
    >
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-32" />
        </div>
      ) : (
        <div className="space-y-6">
          {extError && (
            <AlertBanner variant="danger" title={t('Backend health unavailable')}>
              {t('Could not load backend component health. Values below may be incomplete.')}
            </AlertBanner>
          )}
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{t('Component Health')}</h4>
            <DataTable
              tableId="system:backend-components"
              columns={componentColumns}
              data={componentRows}
              keyExtractor={(r) => r.name}
              compact
              pagination
              emptyMessage={t('No components found')}
            />
          </div>

          {pool && (
            <div>
              <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{t('Database Connection Pool')}</h4>
              <Grid cols={{ default: 2, md: 5 }} gap={3}>
                <StatCard label={t('Max Open')} value={fmtInt(pool.maxOpen)} icon={<Database className="h-4 w-4" />} />
                <StatCard label={t('Open')} value={fmtInt(pool.open)} icon={<Database className="h-4 w-4" />} />
                <StatCard label={t('In Use')} value={fmtInt(pool.inUse)} icon={<Activity className="h-4 w-4" />} />
                <StatCard label={t('Idle')} value={fmtInt(pool.idle)} icon={<Clock className="h-4 w-4" />} />
                <StatCard label={t('Wait Count')} value={fmtInt(pool.waitCount)} icon={<Gauge className="h-4 w-4" />} />
              </Grid>
            </div>
          )}

          {(extHealth?.system || version) && (
            <div>
              <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{t('System Runtime')}</h4>
              <KVList
                columns={2}
                items={[
                  { label: t('Go Version'), value: version?.go_version ?? extHealth?.system?.go_version ?? '—' },
                  { label: t('Uptime'), value: formatUptime(version?.uptime_seconds ?? extHealth?.system?.uptime_seconds ?? 0) },
                  { label: t('Goroutines'), value: fmtInt(version?.goroutines ?? extHealth?.system?.goroutines ?? 0) },
                  { label: t('OS / Arch'), value: version ? `${version.os} / ${version.arch}` : '—' },
                ]}
              />
            </div>
          )}
        </div>
      )}
    </AccordionSection>
  );
}
