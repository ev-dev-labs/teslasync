import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { StatCard } from '@/components/data-display/StatCard';
import { useSignalGaps } from '@/api/hooks/useTelemetry';
import type { SignalRow } from '@/types/telemetry';

type SortMode = 'staleness' | 'alpha' | 'category';
type FilterMode = 'all' | 'stale' | 'active';

function formatStaleness(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

export default function SignalGapDetectorPage() {
  const { t } = useTranslation();
  const [sort, setSort] = useState<SortMode>('staleness');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');

  const { data: liveSignals, isLoading, error } = useSignalGaps();

  const signals: SignalRow[] = useMemo(() => {
    if (!liveSignals) return [];
    const now = Date.now();
    return Object.entries(liveSignals).map(([name, info]) => {
      const ts = info.timestamp ? new Date(info.timestamp).getTime() : 0;
      const staleness = ts ? Math.floor((now - ts) / 1000) : Infinity;
      const category: SignalRow['category'] = !ts ? 'never' : staleness > 300 ? 'stale' : 'active';
      return { name, value: String(info.value ?? ''), timestamp: info.timestamp ?? null, staleness, category };
    });
  }, [liveSignals]);

  const filtered = useMemo(() => {
    let result = signals;
    if (search) result = result.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()));
    if (filter === 'stale') result = result.filter((s) => s.category === 'stale' || s.category === 'never');
    if (filter === 'active') result = result.filter((s) => s.category === 'active');
    if (sort === 'staleness') result = [...result].sort((a, b) => b.staleness - a.staleness);
    else if (sort === 'alpha') result = [...result].sort((a, b) => a.name.localeCompare(b.name));
    else result = [...result].sort((a, b) => a.category.localeCompare(b.category));
    return result;
  }, [signals, search, filter, sort]);

  const activeCount = signals.filter((s) => s.category === 'active').length;
  const staleCount = signals.filter((s) => s.category === 'stale').length;
  const neverCount = signals.filter((s) => s.category === 'never').length;

  const categoryVariant: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
    active: 'success', stale: 'warning', never: 'danger',
  };

  return (
    <PageContainer
      title={t('Signal Gap Detector')}
      subtitle={t('Identify stale, inactive, or missing signals — refreshes every 5s')}
      loading={isLoading}
      error={error as Error | null}
      empty={!signals.length}
      emptyMessage={t('No signals found.')}
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Total Signals')} value={signals.length} />
        <StatCard label={t('Active (<30s)')} value={activeCount} />
        <StatCard label={t('Stale (>5min)')} value={staleCount} />
        <StatCard label={t('Never Received')} value={neverCount} />
      </Grid>

      <div className="flex gap-2 flex-wrap items-center">
        <Input placeholder={t('Search...')} value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        {(['all', 'stale', 'active'] as FilterMode[]).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? 'primary' : 'outline'} onClick={() => setFilter(f)}>
            {t(f === 'all' ? 'All' : f === 'stale' ? 'Stale Only' : 'Active Only')}
          </Button>
        ))}
        <div className="ml-auto flex gap-2">
          {(['staleness', 'alpha', 'category'] as SortMode[]).map((s) => (
            <Button key={s} size="sm" variant={sort === s ? 'primary' : 'outline'} onClick={() => setSort(s)}>
              {t(s === 'staleness' ? 'Most Stale' : s === 'alpha' ? 'A-Z' : 'Category')}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader title={t('Signals')} subtitle={`${filtered.length} shown`} />
        <div className="max-h-96 overflow-y-auto divide-y divide-gray-800">
          {filtered.map((s) => (
            <div key={s.name} className="flex items-center gap-3 px-2 py-1 text-xs font-mono">
              <Badge variant={categoryVariant[s.category] ?? 'neutral'} size="sm">{s.category}</Badge>
              <span className="flex-1 truncate max-w-[200px]">{s.name}</span>
              <span className="w-28 truncate text-gray-400 shrink-0">{s.value || '--'}</span>
              <span className="w-36 text-gray-400 shrink-0">{s.timestamp ? new Date(s.timestamp).toLocaleString() : '--'}</span>
              <span className="w-16 text-right shrink-0">
                {s.category === 'never' ? '--' : formatStaleness(s.staleness)}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </PageContainer>
  );
}
