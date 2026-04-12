import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
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
              <button
                key={s}
                onClick={() => { setSelectedSignal(s); setPage(1); }}
                className={`block w-full text-left text-xs font-mono px-2 py-1 rounded truncate ${
                  s === selectedSignal ? 'bg-cyan-500/20 text-cyan-300' : 'hover:bg-gray-800 text-gray-300'
                }`}
              >
                {s}
              </button>
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
            <select
              className="ml-auto rounded border px-2 py-1 text-xs bg-transparent"
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            >
              {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}/page</option>)}
            </select>
          </div>

          <StatCard label={t('Total Records')} value={logData?.count ?? 0} />

          <Card>
            <CardHeader title={selectedSignal || t('Select a signal')} />
            {logData?.data?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="border-b border-gray-700 text-gray-400">
                      <th className="py-1 px-2 text-left">#</th>
                      <th className="py-1 px-2 text-left">{t('Timestamp')}</th>
                      <th className="py-1 px-2 text-left">{t('Value')}</th>
                      <th className="py-1 px-2 text-left">{t('Type')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logData.data.map((entry, i) => {
                      const vt = valueType(entry);
                      return (
                        <tr key={i} className="border-b border-gray-800">
                          <td className="py-1 px-2 text-gray-500">{(page - 1) * pageSize + i + 1}</td>
                          <td className="py-1 px-2 text-gray-400">{new Date(entry.timestamp).toLocaleString()}</td>
                          <td className="py-1 px-2">{formatValue(entry)}</td>
                          <td className="py-1 px-2"><Badge variant={typeVariant[vt] ?? 'neutral'} size="sm">{vt}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
