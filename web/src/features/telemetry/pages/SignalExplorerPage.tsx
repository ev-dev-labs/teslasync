import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/data-display/StatCard';
import { useSignals, useSignalHistory } from '@/api/hooks/useTelemetry';

const TIME_RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
];

export default function SignalExplorerPage() {
  const { t } = useTranslation();
  const [selectedSignal, setSelectedSignal] = useState('');
  const [search, setSearch] = useState('');
  const [hours, setHours] = useState(24);

  const { data: signals, isLoading, error } = useSignals();
  const { data: history } = useSignalHistory(selectedSignal, hours);

  const filtered = signals?.filter((s) => s.toLowerCase().includes(search.toLowerCase())) ?? [];

  return (
    <PageContainer
      title={t('Signal Explorer')}
      subtitle={t('Browse vehicle signals and historical values')}
      loading={isLoading}
      error={error as Error | null}
      empty={!signals?.length}
      emptyMessage={t('No signals available.')}
      actions={<Badge variant="info">{signals?.length ?? 0} {t('signals')}</Badge>}
    >
      <Grid cols={{ default: 1, md: 4 }} gap={4}>
        <Card className="md:col-span-1">
          <CardHeader title={t('Signals')} />
          <div className="px-3 pb-2">
            <Input placeholder={t('Search signals...')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="max-h-80 overflow-y-auto px-3 pb-3 space-y-1">
            {filtered.map((s) => (
              <button
                key={s}
                onClick={() => setSelectedSignal(s)}
                className={`block w-full text-left text-xs font-mono px-2 py-1 rounded truncate ${
                  s === selectedSignal ? 'bg-cyan-500/20 text-cyan-300' : 'hover:bg-gray-800 text-gray-300'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </Card>

        <div className="md:col-span-3 space-y-4">
          {selectedSignal ? (
            <>
              <Card>
                <CardHeader title={selectedSignal} subtitle={t('Signal Detail')} />
                <div className="flex gap-2 px-4 pb-3 flex-wrap">
                  {TIME_RANGES.map((r) => (
                    <Button
                      key={r.label}
                      size="sm"
                      variant={hours === r.hours ? 'primary' : 'outline'}
                      onClick={() => setHours(r.hours)}
                    >
                      {r.label}
                    </Button>
                  ))}
                </div>
              </Card>

              <Grid cols={{ default: 2 }} gap={4}>
                <StatCard label={t('Data Points')} value={history?.count ?? 0} />
                <StatCard label={t('Time Range')} value={`${hours}h`} />
              </Grid>

              <Card>
                <CardHeader title={t('History')} subtitle={`${history?.count ?? 0} points`} />
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="border-b border-gray-700 text-gray-400">
                        <th className="py-1 px-2 text-left">{t('Timestamp')}</th>
                        <th className="py-1 px-2 text-left">{t('Value')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history?.data?.slice(0, 100).map((p, i) => (
                        <tr key={i} className="border-b border-gray-800">
                          <td className="py-1 px-2 text-gray-400">{new Date(p.timestamp).toLocaleString()}</td>
                          <td className="py-1 px-2">{p.valueNum ?? p.valueStr ?? String(p.valueBool ?? '')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          ) : (
            <Card className="flex items-center justify-center py-16">
              <p className="text-gray-500">{t('Select a signal to explore')}</p>
            </Card>
          )}
        </div>
      </Grid>
    </PageContainer>
  );
}
