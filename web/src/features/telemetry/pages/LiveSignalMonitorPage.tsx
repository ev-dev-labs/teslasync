import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { StatCard } from '@/components/data-display/StatCard';
import type { SignalEntry } from '@/types/telemetry';

const MAX_BUFFER = 500;

export default function LiveSignalMonitorPage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<SignalEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const idRef = useRef(0);
  const pausedRef = useRef(false);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const handleSignal = useCallback((name: string, value: unknown) => {
    if (pausedRef.current) return;
    const type: SignalEntry['type'] =
      typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string';
    const entry: SignalEntry = {
      id: ++idRef.current,
      timestamp: new Date().toISOString(),
      name,
      value: String(value),
      type,
    };
    setEntries((prev) => [entry, ...prev].slice(0, MAX_BUFFER));
  }, []);

  // Simulated signal stream for demonstration
  useEffect(() => {
    const interval = setInterval(() => {
      handleSignal('demo_signal', Math.random() * 100);
    }, 2000);
    return () => clearInterval(interval);
  }, [handleSignal]);

  const filtered = useMemo(
    () => (filter ? entries.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase())) : entries),
    [entries, filter],
  );

  const uniqueSignals = useMemo(() => new Set(entries.map((e) => e.name)).size, [entries]);

  const typeVariant: Record<string, 'info' | 'success' | 'warning'> = {
    number: 'info', string: 'success', boolean: 'warning',
  };

  return (
    <PageContainer
      title={t('Live Signal Monitor')}
      subtitle={t('Real-time scrolling view of incoming signals')}
      actions={<Badge variant={paused ? 'warning' : 'success'} dot>{paused ? t('Paused') : t('Live')}</Badge>}
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Buffer Size')} value={`${entries.length}/${MAX_BUFFER}`} />
        <StatCard label={t('Unique Signals')} value={uniqueSignals} />
        <StatCard label={t('Filtered')} value={filtered.length} />
        <StatCard label={t('Status')} value={paused ? t('Paused') : t('Streaming')} />
      </Grid>

      <div className="flex gap-2 flex-wrap items-center">
        <Input placeholder={t('Filter signals...')} value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-xs" />
        <Button size="sm" variant={paused ? 'primary' : 'outline'} onClick={() => setPaused(!paused)}>
          {paused ? t('Resume') : t('Pause')}
        </Button>
        <Button size="sm" variant="danger" onClick={() => { setEntries([]); idRef.current = 0; }}>
          {t('Clear')}
        </Button>
      </div>

      <Card>
        <CardHeader title={t('Signal Stream')} subtitle={`${filtered.length} entries`} />
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 sticky top-0 bg-gray-900">
                <th className="py-1 px-2 text-left">{t('Time')}</th>
                <th className="py-1 px-2 text-left">{t('Signal')}</th>
                <th className="py-1 px-2 text-left">{t('Value')}</th>
                <th className="py-1 px-2 text-left">{t('Type')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((e) => (
                <tr key={e.id} className="border-b border-gray-800">
                  <td className="py-1 px-2 text-gray-400">{new Date(e.timestamp).toLocaleTimeString()}</td>
                  <td className="py-1 px-2 truncate max-w-[200px]">{e.name}</td>
                  <td className="py-1 px-2">{e.value}</td>
                  <td className="py-1 px-2"><Badge variant={typeVariant[e.type] ?? 'neutral'} size="sm">{e.type}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </PageContainer>
  );
}
