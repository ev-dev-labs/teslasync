import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui';
import { StatCard } from '@/components/data-display/StatCard';
import { useSignals, useSignalLog } from '@/api/hooks/useTelemetry';

const PAGE_SIZES = [25, 50, 100, 200];

export default function SignalLogViewerPage() {
  const { t } = useTranslation();
  const [selectedSignal, setSelectedSignal] = useState('');
  const [search, setSearch] = useState('');
  const [hours, setHours] = useState(24);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const { data: signals, isLoading, error } = useSignals();
  const { data: logData } = useSignalLog(selectedSignal, hours, page, pageSize);

  const filtered = signals?.filter((s) => s.toLowerCase().includes(search.toLowerCase())) ?? [];

  function valueType(entry: { valueNum?: number; valueStr?: string; valueBool?: boolean }): string {
    if (entry.valueNum !== undefined) return 'number';
    if (entry.valueBool !== undefined) return 'boolean';
    return 'string';
  }

  function formatValue(entry: { valueNum?: number; valueStr?: string; valueBool?: boolean }): string {
    if (entry.valueNum !== undefined) return entry.valueNum.toFixed(4);
    if (entry.valueBool !== undefined) return String(entry.valueBool);
    return entry.valueStr ?? '';
  }

  const typeVariant: Record<string, 'info' | 'success' | 'warning'> = {
    number: 'info', string: 'success', boolean: 'warning',
  };

  return (
    <PageContainer
      title={t('Signal Log Viewer')}
      subtitle={t('Browse raw telemetry signal recordings')}
      loading={isLoading}
      error={error as Error | null}
      empty={!signals?.length}
      emptyMessage={t('No signals available.')}
    >
      <Grid cols={{ default: 1, md: 5 }} gap={4}>
        <Card className="md:col-span-1">
          <CardHeader title={t('Signals')} />
          <div className="px-3 pb-2">
            <Input placeholder={t('Filter...')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="max-h-96 overflow-y-auto px-3 pb-3 space-y-1">
            {filtered.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={s === selectedSignal ? 'primary' : 'ghost'}
                onClick={() => { setSelectedSignal(s); setPage(1); }}
                className="block w-full text-left text-xs font-mono truncate"
              >
                {s}
              </Button>
            ))}
          </div>
        </Card>

        <div className="md:col-span-4 space-y-4">
          <div className="flex gap-2 flex-wrap items-center">
            {[1, 6, 24, 168, 720].map((h) => (
              <Button key={h} size="sm" variant={hours === h ? 'primary' : 'outline'} onClick={() => { setHours(h); setPage(1); }}>
                {h < 48 ? `${h}h` : `${h / 24}d`}
              </Button>
            ))}
            <Select
              options={PAGE_SIZES.map((s) => ({ value: String(s), label: `${s}/page` }))}
              className="ml-auto"
              value={String(pageSize)}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            />
          </div>

          <StatCard label={t('Total Records')} value={logData?.count ?? 0} />

          <Card>
            <CardHeader title={selectedSignal || t('Select a signal')} />
            {logData?.data?.length ? (
              <div className="divide-y divide-gray-800">
                {logData.data.map((entry, i) => {
                  const vt = valueType(entry);
                  return (
                    <div key={i} className="flex items-center gap-3 px-2 py-1 text-xs font-mono">
                      <span className="w-8 text-gray-500 shrink-0">{(page - 1) * pageSize + i + 1}</span>
                      <span className="w-40 text-gray-400 shrink-0">{new Date(entry.timestamp).toLocaleString()}</span>
                      <span className="flex-1">{formatValue(entry)}</span>
                      <Badge variant={typeVariant[vt] ?? 'neutral'} size="sm">{vt}</Badge>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-gray-500 text-sm text-center py-8">{t('No data')}</p>
            )}
          </Card>

          <div className="flex justify-center gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(1)}>{t('First')}</Button>
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('Prev')}</Button>
            <span className="text-sm text-gray-400 self-center">{t('Page')} {page}</span>
            <Button size="sm" variant="outline" onClick={() => setPage(page + 1)}>{t('Next')}</Button>
          </div>
        </div>
      </Grid>
    </PageContainer>
  );
}
