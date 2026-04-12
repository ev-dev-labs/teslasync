import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui';
import { StatCard } from '@/components/data-display/StatCard';
import { useSignals, useSignalDiff } from '@/api/hooks/useTelemetry';
import type { RangeStats } from '@/types/telemetry';

function computeStats(data: { valueNum?: number }[]): RangeStats {
  const nums = data.map((d) => d.valueNum).filter((n): n is number => n !== undefined);
  if (!nums.length) return { min: 0, max: 0, avg: 0, count: 0 };
  return {
    min: Math.min(...nums),
    max: Math.max(...nums),
    avg: nums.reduce((a, b) => a + b, 0) / nums.length,
    count: nums.length,
  };
}

function toLocal(date: Date): string {
  return date.toISOString().slice(0, 16);
}

export default function SignalDiffPage() {
  const { t } = useTranslation();
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);

  const [signal, setSignal] = useState('');
  const [rangeAFrom, setRangeAFrom] = useState(toLocal(yesterday));
  const [rangeATo, setRangeATo] = useState(toLocal(now));
  const [rangeBFrom, setRangeBFrom] = useState(toLocal(new Date(yesterday.getTime() - 86_400_000)));
  const [rangeBTo, setRangeBTo] = useState(toLocal(yesterday));

  const { data: signals, isLoading, error } = useSignals();
  const { data: dataA } = useSignalDiff(signal, rangeAFrom, rangeATo);
  const { data: dataB } = useSignalDiff(signal, rangeBFrom, rangeBTo);

  const statsA = useMemo(() => computeStats(dataA?.data ?? []), [dataA]);
  const statsB = useMemo(() => computeStats(dataB?.data ?? []), [dataB]);

  const rows: { label: string; a: number; b: number }[] = [
    { label: 'Min', a: statsA.min, b: statsB.min },
    { label: 'Max', a: statsA.max, b: statsB.max },
    { label: 'Avg', a: statsA.avg, b: statsB.avg },
    { label: 'Count', a: statsA.count, b: statsB.count },
  ];

  function applyPreset(preset: 'day' | 'week') {
    const today = new Date();
    if (preset === 'day') {
      const yd = new Date(today.getTime() - 86_400_000);
      setRangeAFrom(toLocal(yd)); setRangeATo(toLocal(today));
      setRangeBFrom(toLocal(new Date(yd.getTime() - 86_400_000))); setRangeBTo(toLocal(yd));
    } else {
      const weekAgo = new Date(today.getTime() - 7 * 86_400_000);
      const twoWeeks = new Date(today.getTime() - 14 * 86_400_000);
      setRangeAFrom(toLocal(weekAgo)); setRangeATo(toLocal(today));
      setRangeBFrom(toLocal(twoWeeks)); setRangeBTo(toLocal(weekAgo));
    }
  }

  return (
    <PageContainer
      title={t('Signal Diff')}
      subtitle={t('Compare signal values across two time ranges')}
      loading={isLoading}
      error={error as Error | null}
      empty={!signals?.length}
      emptyMessage={t('No signals available.')}
    >
      <Card>
        <CardHeader title={t('Configuration')} />
        <div className="px-4 pb-4 space-y-3">
          <Select
            options={[
              { value: '', label: t('Select signal...') },
              ...(signals ?? []).map((s) => ({ value: s, label: s })),
            ]}
            value={signal}
            onChange={(e) => setSignal(e.target.value)}
          />

          <Grid cols={{ default: 1, md: 2 }} gap={4}>
            <div className="space-y-2">
              <p className="text-xs font-semibold text-cyan-400">{t('Range A')}</p>
              <Input label={t('From')} type="datetime-local" value={rangeAFrom} onChange={(e) => setRangeAFrom(e.target.value)} />
              <Input label={t('To')} type="datetime-local" value={rangeATo} onChange={(e) => setRangeATo(e.target.value)} />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold text-amber-400">{t('Range B')}</p>
              <Input label={t('From')} type="datetime-local" value={rangeBFrom} onChange={(e) => setRangeBFrom(e.target.value)} />
              <Input label={t('To')} type="datetime-local" value={rangeBTo} onChange={(e) => setRangeBTo(e.target.value)} />
            </div>
          </Grid>

          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => applyPreset('day')}>{t('Today vs Yesterday')}</Button>
            <Button size="sm" variant="outline" onClick={() => applyPreset('week')}>{t('This Week vs Last Week')}</Button>
          </div>
        </div>
      </Card>

      <Grid cols={{ default: 2 }} gap={4}>
        <StatCard label={t('Range A Points')} value={statsA.count} />
        <StatCard label={t('Range B Points')} value={statsB.count} />
      </Grid>

      <Card>
        <CardHeader title={t('Comparison Summary')} />
        <div className="divide-y divide-gray-800">
          {rows.map((r) => {
            const diff = r.a - r.b;
            return (
              <div key={r.label} className="flex items-center gap-4 px-3 py-2 text-sm">
                <span className="w-20 font-medium shrink-0">{t(r.label)}</span>
                <span className="w-24 text-right shrink-0">{(r.a ?? 0).toFixed(2)}</span>
                <span className="w-24 text-right shrink-0">{(r.b ?? 0).toFixed(2)}</span>
                <Badge variant={diff > 0 ? 'success' : diff < 0 ? 'danger' : 'neutral'} size="sm">
                  {diff > 0 ? '+' : ''}{diff.toFixed(2)}
                </Badge>
              </div>
            );
          })}
        </div>
      </Card>
    </PageContainer>
  );
}
