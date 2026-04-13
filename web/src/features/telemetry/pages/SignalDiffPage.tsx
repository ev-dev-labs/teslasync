import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { GitCompare, ArrowUp, ArrowDown, Minus } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { GlassPanel, Button, Input, Select, DataTable, type Column } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import {
  ChartTooltip,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { useSignals, useSignalDiff } from '@/api/hooks/useTelemetry';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { RangeStats, SignalHistoryResponse } from '@/types/telemetry';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function computeStats(data: SignalHistoryResponse['data']): RangeStats {
  const nums = data.map((d) => d.valueNum).filter((v): v is number => v != null);
  if (nums.length === 0) return { min: 0, max: 0, avg: 0, count: 0 };
  return {
    min: Math.min(...nums),
    max: Math.max(...nums),
    avg: nums.reduce((a, b) => a + b, 0) / nums.length,
    count: nums.length,
  };
}

function toLocalDatetimeInput(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

/* ------------------------------------------------------------------ */
/*  Diff indicator                                                     */
/* ------------------------------------------------------------------ */

function DiffIndicator({ a, b }: { a: number; b: number }) {
  const diff = a - b;
  const icon = diff > 0 ? <ArrowUp className="h-3 w-3" /> : diff < 0 ? <ArrowDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />;
  const color = diff > 0 ? 'text-green-400' : diff < 0 ? 'text-red-400' : 'text-[var(--text-muted)]';
  return (
    <span className={cn('flex items-center gap-0.5 font-mono font-medium', color)}>
      {icon} {fmtNumber(Math.abs(diff))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Comparison table columns                                           */
/* ------------------------------------------------------------------ */

interface ComparisonRow { label: string; a: number; b: number }

function buildComparisonColumns(t: (k: string, d: string) => string): Column<ComparisonRow>[] {
  return [
    { key: 'metric', header: t('signalDiff.metric', 'Metric'), render: (row) => <span className="text-[var(--text-secondary)]">{row.label}</span> },
    { key: 'rangeA', header: t('signalDiff.rangeA', 'Range A'), className: 'text-right', render: (row) => <span className="font-mono text-[var(--text-primary)]">{fmtNumber(row.a)}</span> },
    { key: 'rangeB', header: t('signalDiff.rangeB', 'Range B'), className: 'text-right', render: (row) => <span className="font-mono text-[var(--text-primary)]">{fmtNumber(row.b)}</span> },
    { key: 'diff', header: t('signalDiff.diff', 'Diff'), className: 'text-right', render: (row) => <DiffIndicator a={row.a} b={row.b} /> },
  ];
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SignalDiffPage() {
  const { t } = useTranslation();
  usePageTitle(t('signalDiff.title', 'Signal Diff'));

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const yesterdayStart = startOfDay(new Date(now.getTime() - 86400000));
  const yesterdayEnd = endOfDay(new Date(now.getTime() - 86400000));

  const [selectedSignal, setSelectedSignal] = useState('');
  const [rangeAFrom, setRangeAFrom] = useState(toLocalDatetimeInput(todayStart));
  const [rangeATo, setRangeATo] = useState(toLocalDatetimeInput(todayEnd));
  const [rangeBFrom, setRangeBFrom] = useState(toLocalDatetimeInput(yesterdayStart));
  const [rangeBTo, setRangeBTo] = useState(toLocalDatetimeInput(yesterdayEnd));

  const { data: availableSignals } = useSignals();

  const { data: historyA, isLoading: loadingA } = useSignalDiff(
    selectedSignal,
    rangeAFrom ? new Date(rangeAFrom).toISOString() : '',
    rangeATo ? new Date(rangeATo).toISOString() : '',
  );
  const { data: historyB, isLoading: loadingB } = useSignalDiff(
    selectedSignal,
    rangeBFrom ? new Date(rangeBFrom).toISOString() : '',
    rangeBTo ? new Date(rangeBTo).toISOString() : '',
  );

  const statsA = useMemo(() => computeStats(historyA?.data ?? []), [historyA]);
  const statsB = useMemo(() => computeStats(historyB?.data ?? []), [historyB]);

  const chartDataA = useMemo(
    () => (historyA?.data ?? []).map((p) => ({
      time: new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      value: p.valueNum ?? (p.valueBool ? 1 : 0),
    })),
    [historyA],
  );

  const chartDataB = useMemo(
    () => (historyB?.data ?? []).map((p) => ({
      time: new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      value: p.valueNum ?? (p.valueBool ? 1 : 0),
    })),
    [historyB],
  );

  const comparisonRows: ComparisonRow[] = [
    { label: t('signalDiff.min', 'Min'), a: statsA.min, b: statsB.min },
    { label: t('signalDiff.max', 'Max'), a: statsA.max, b: statsB.max },
    { label: t('signalDiff.average', 'Average'), a: statsA.avg, b: statsB.avg },
    { label: t('signalDiff.dataPoints', 'Data Points'), a: statsA.count, b: statsB.count },
  ];

  const comparisonColumns = useMemo(() => buildComparisonColumns(t), [t]);

  function applyPreset(preset: 'today-yesterday' | 'week') {
    if (preset === 'today-yesterday') {
      setRangeAFrom(toLocalDatetimeInput(todayStart));
      setRangeATo(toLocalDatetimeInput(todayEnd));
      setRangeBFrom(toLocalDatetimeInput(yesterdayStart));
      setRangeBTo(toLocalDatetimeInput(yesterdayEnd));
    } else {
      const thisWeekStart = new Date(now);
      thisWeekStart.setDate(now.getDate() - now.getDay());
      thisWeekStart.setHours(0, 0, 0, 0);
      const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 86400000);
      const lastWeekEnd = new Date(thisWeekStart.getTime() - 1);
      setRangeAFrom(toLocalDatetimeInput(thisWeekStart));
      setRangeATo(toLocalDatetimeInput(now));
      setRangeBFrom(toLocalDatetimeInput(lastWeekStart));
      setRangeBTo(toLocalDatetimeInput(lastWeekEnd));
    }
  }

  return (
    <PageContainer
      title={t('signalDiff.title', 'Signal Diff')}
      subtitle={t('signalDiff.subtitle', 'Compare signal values across two time ranges')}
    >
      {/* Controls */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <span className="block text-xs text-[var(--text-muted)] mb-1.5">{t('signalDiff.signal', 'Signal')}</span>
              <Select
                value={selectedSignal}
                onChange={(e) => setSelectedSignal(e.target.value)}
                options={[
                  { value: '', label: t('signalDiff.selectSignal', 'Select a signal…') },
                  ...(availableSignals ?? []).map((s) => ({ value: s, label: s })),
                ]}
              />
            </div>
            <div>
              <span className="block text-xs text-cyan-400 mb-1.5">{t('signalDiff.rangeA', 'Range A')}</span>
              <div className="flex gap-2">
                <Input type="datetime-local" value={rangeAFrom} onChange={(e) => setRangeAFrom(e.target.value)} className="flex-1" />
                <Input type="datetime-local" value={rangeATo} onChange={(e) => setRangeATo(e.target.value)} className="flex-1" />
              </div>
            </div>
            <div>
              <span className="block text-xs text-amber-400 mb-1.5">{t('signalDiff.rangeB', 'Range B')}</span>
              <div className="flex gap-2">
                <Input type="datetime-local" value={rangeBFrom} onChange={(e) => setRangeBFrom(e.target.value)} className="flex-1" />
                <Input type="datetime-local" value={rangeBTo} onChange={(e) => setRangeBTo(e.target.value)} className="flex-1" />
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button variant="secondary" size="sm" onClick={() => applyPreset('today-yesterday')}>
              {t('signalDiff.todayVsYesterday', 'Today vs Yesterday')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => applyPreset('week')}>
              {t('signalDiff.thisWeekVsLast', 'This Week vs Last Week')}
            </Button>
          </div>
        </GlassPanel>
      </FadeIn>

      {selectedSignal ? (
        <>
          {/* Stats */}
          <FadeIn>
            <Grid cols={{ default: 2, lg: 4 }} gap={4}>
              <StatCard label={t('signalDiff.rangeAPoints', 'Range A Points')} value={statsA.count} />
              <StatCard label={t('signalDiff.rangeBPoints', 'Range B Points')} value={statsB.count} />
              <StatCard label={t('signalDiff.avgDiff', 'Avg Diff')} value={fmtNumber(statsA.avg - statsB.avg)} />
              <StatCard label={t('signalDiff.maxDiff', 'Max Diff')} value={fmtNumber(statsA.max - statsB.max)} />
            </Grid>
          </FadeIn>

          {/* Side-by-Side Charts */}
          <FadeIn delay={0.2}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <GlassPanel className="p-5">
                <h3 className="text-sm font-semibold text-cyan-400 mb-3">{t('signalDiff.rangeA', 'Range A')}</h3>
                {loadingA ? (
                  <Skeleton className="h-56" />
                ) : chartDataA.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={chartDataA}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
                      <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Line type="monotone" dataKey="value" stroke="#00f0ff" strokeWidth={1.5} dot={false} name={selectedSignal} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-56 flex items-center justify-center text-[var(--text-muted)] text-sm">
                    {t('signalDiff.noDataA', 'No data in Range A')}
                  </div>
                )}
              </GlassPanel>

              <GlassPanel className="p-5">
                <h3 className="text-sm font-semibold text-amber-400 mb-3">{t('signalDiff.rangeB', 'Range B')}</h3>
                {loadingB ? (
                  <Skeleton className="h-56" />
                ) : chartDataB.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={chartDataB}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
                      <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Line type="monotone" dataKey="value" stroke="#f59e0b" strokeWidth={1.5} dot={false} name={selectedSignal} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-56 flex items-center justify-center text-[var(--text-muted)] text-sm">
                    {t('signalDiff.noDataB', 'No data in Range B')}
                  </div>
                )}
              </GlassPanel>
            </div>
          </FadeIn>

          {/* Comparison Table */}
          <FadeIn delay={0.3}>
            <GlassPanel className="p-5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
                {t('signalDiff.comparisonSummary', 'Comparison Summary')}
              </h3>
              <DataTable<ComparisonRow>
                columns={comparisonColumns}
                data={comparisonRows}
                keyExtractor={(row) => row.label}
              />
            </GlassPanel>
          </FadeIn>
        </>
      ) : (
        <FadeIn delay={0.2}>
          <GlassPanel className="p-12 flex flex-col items-center justify-center">
            <GitCompare className="h-12 w-12 text-[var(--text-muted)] opacity-30 mb-3" />
            <p className="text-lg text-[var(--text-muted)]">{t('signalDiff.selectPrompt', 'Select a signal to compare')}</p>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              {t('signalDiff.selectHint', 'Choose a signal and configure two time ranges to compare')}
            </p>
          </GlassPanel>
        </FadeIn>
      )}
    </PageContainer>
  );
}
