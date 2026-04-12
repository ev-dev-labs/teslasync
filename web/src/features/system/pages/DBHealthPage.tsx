import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { useDBStats, useMigrations, useConnectionPool } from '@/api/hooks/useAdmin';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

type SortKey = 'size' | 'rows' | 'name';

export default function DBHealthPage() {
  const { t } = useTranslation();
  const { data: dbStats, isLoading, error } = useDBStats();
  const { data: migrations } = useMigrations();
  const { data: pool } = useConnectionPool();
  const [sortBy, setSortBy] = useState<SortKey>('size');

  const sortedTables = useMemo(() => {
    const tables = dbStats?.tables ?? [];
    return [...tables].sort((a, b) => {
      if (sortBy === 'size') return b.sizeBytes - a.sizeBytes;
      if (sortBy === 'rows') return b.rowCount - a.rowCount;
      return a.name.localeCompare(b.name);
    });
  }, [dbStats?.tables, sortBy]);

  const largeTables = sortedTables.filter((t) => t.sizeBytes > 100 * 1024 * 1024).length;
  const poolUsage = pool ? Math.round((pool.inUse / pool.maxOpen) * 100) : 0;

  return (
    <PageContainer
      title={t('Database Health')}
      subtitle={t('PostgreSQL statistics, migrations, and connection pool')}
      loading={isLoading}
      error={error as Error | null}
      empty={!dbStats}
      emptyMessage={t('Unable to load database stats.')}
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Database Size')} value={dbStats?.databaseSize ?? '--'} />
        <StatCard label={t('Table Count')} value={dbStats?.tableCount ?? 0} />
        <StatCard label={t('Large Tables')} value={largeTables} />
        <StatCard label={t('Migration')} value={migrations?.currentVersion ?? '--'} />
      </Grid>

      <Card>
        <CardHeader
          title={t('Tables')}
          action={
            <div className="flex gap-1">
              {(['size', 'rows', 'name'] as SortKey[]).map((k) => (
                <Button key={k} size="sm" variant={sortBy === k ? 'primary' : 'outline'} onClick={() => setSortBy(k)}>
                  {t(k === 'size' ? 'Size' : k === 'rows' ? 'Rows' : 'Name')}
                </Button>
              ))}
            </div>
          }
        />
        <div className="max-h-80 overflow-y-auto divide-y divide-gray-800">
          {sortedTables.map((table) => (
            <div key={table.name} className="flex items-center gap-4 px-3 py-2 text-sm">
              <span className="w-48 font-mono text-xs shrink-0">
                {table.sizeBytes > 100 * 1024 * 1024 && <span className="text-amber-400 mr-1">⚠</span>}
                {table.name}
              </span>
              <span className="w-24 text-right shrink-0">{(table.rowCount ?? 0).toLocaleString()}</span>
              <span className="w-20 text-right shrink-0">{formatBytes(table.sizeBytes)}</span>
              <span className="w-16 text-right shrink-0">{table.indexCount}</span>
              <span className="text-gray-400">{table.lastVacuum ? new Date(table.lastVacuum).toLocaleDateString() : '--'}</span>
            </div>
          ))}
        </div>
      </Card>

      <Grid cols={{ default: 1, md: 2 }} gap={4}>
        <Card>
          <CardHeader title={t('Migration Status')} />
          <KVList items={[
            { label: t('Version'), value: <span className="font-mono">{migrations?.currentVersion ?? '--'}</span> },
            { label: t('Dirty'), value: <Badge variant={migrations?.dirty ? 'danger' : 'success'} size="sm">{migrations?.dirty ? 'Yes' : 'No'}</Badge> },
            { label: t('Pending'), value: String(migrations?.pending ?? 0) },
          ]} />
        </Card>

        <Card>
          <CardHeader title={t('Connection Pool')} />
          <KVList items={[
            { label: t('Max / Open'), value: `${pool?.open ?? 0} / ${pool?.maxOpen ?? 0}` },
            { label: t('In Use'), value: String(pool?.inUse ?? 0) },
            { label: t('Idle'), value: String(pool?.idle ?? 0) },
            { label: t('Wait Count'), value: String(pool?.waitCount ?? 0) },
          ]} />
          <div className="px-4 pb-4">
            <div className="h-2 bg-gray-700 rounded overflow-hidden">
              <div
                className={`h-2 rounded ${poolUsage >= 80 ? 'bg-red-500' : 'bg-cyan-400'}`}
                style={{ width: `${poolUsage}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">{poolUsage}% {t('utilization')}</p>
          </div>
        </Card>
      </Grid>
    </PageContainer>
  );
}
