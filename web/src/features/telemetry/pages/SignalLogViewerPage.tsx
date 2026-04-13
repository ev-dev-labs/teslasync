/**
 * SignalLogViewerPage — query signal history from Postgres.
 *
 * Select signals, set date range, click Query to browse paginated signal history.
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Pagination } from '@/components/ui/Pagination';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { FadeIn } from '@/components/motion/FadeIn';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSignals } from '@/api/hooks/useTelemetry';
import { request } from '@/api/client';
import { CHART_COLORS } from '@/lib/colors';
import { Database, Search, Clock, Activity, Filter } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SignalRow {
  created_at: string;
  signal: string;
  value_num: number | null;
  value_str: string | null;
  value_bool: boolean | null;
}

interface SignalHistoryResp {
  data: SignalRow[];
  pagination?: { total: number; total_pages: number; page: number; per_page: number };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toLocalDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatValue(row: SignalRow): string {
  if (row.value_num !== null && row.value_num !== undefined) return row.value_num.toFixed(4);
  if (row.value_bool !== null && row.value_bool !== undefined) return String(row.value_bool);
  return row.value_str ?? '';
}

function valueType(row: SignalRow): string {
  if (row.value_num !== null && row.value_num !== undefined) return 'number';
  if (row.value_bool !== null && row.value_bool !== undefined) return 'boolean';
  return 'string';
}

const typeVariant: Record<string, 'info' | 'success' | 'warning'> = {
  number: 'info', string: 'success', boolean: 'warning',
};

const PRESETS = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
];

// ─── Page component ──────────────────────────────────────────────────────────

export default function SignalLogViewerPage() {
  const { t } = useTranslation();
  usePageTitle(t('Signal Log'));
  const vehicleId = 1;

  // Signal selection
  const { data: availableSignals } = useSignals(vehicleId);
  const [selectedSignals, setSelectedSignals] = useState<string[]>([]);
  const [signalSearch, setSignalSearch] = useState('');

  // DateTime range
  const [fromStr, setFromStr] = useState(() => toLocalDatetime(new Date(Date.now() - 3600_000)));
  const [toStr, setToStr] = useState(() => toLocalDatetime(new Date()));

  // Pagination
  const [perPage, setPerPage] = useState(50);
  const [page, setPage] = useState(1);

  // Query trigger — only fetch when user clicks "Query"
  const [queryKey, setQueryKey] = useState<number | null>(null);

  const applyPreset = useCallback((hours: number) => {
    const end = new Date();
    setFromStr(toLocalDatetime(new Date(end.getTime() - hours * 3600_000)));
    setToStr(toLocalDatetime(end));
  }, []);

  const canQuery = selectedSignals.length > 0 && fromStr && toStr;

  const handleQuery = useCallback(() => {
    if (!canQuery) return;
    setPage(1);
    setQueryKey(Date.now());
  }, [canQuery]);

  const toggleSignal = useCallback((sig: string) => {
    setSelectedSignals(prev =>
      prev.includes(sig) ? prev.filter(s => s !== sig) : [...prev, sig],
    );
  }, []);

  const signalsCsv = selectedSignals.join(',');
  const fromIso = fromStr ? new Date(fromStr).toISOString() : '';
  const toIso = toStr ? new Date(toStr).toISOString() : '';

  // ── Data query ──
  const { data: historyResp, isLoading, isFetching } = useQuery<SignalHistoryResp>({
    queryKey: ['signal-log', queryKey, page, perPage],
    queryFn: () => {
      const params = new URLSearchParams({
        vehicle_id: String(vehicleId),
        signals: signalsCsv,
        from: fromIso,
        to: toIso,
        page: String(page),
        per_page: String(perPage),
      });
      return request(`/signals/history?${params}`);
    },
    enabled: queryKey !== null,
  });

  const rows = historyResp?.data ?? [];
  const totalRecords = historyResp?.pagination?.total ?? 0;
  const hasQueried = queryKey !== null;

  // Signal search filter
  const filteredSignals = useMemo(() => {
    if (!availableSignals) return [];
    if (!signalSearch) return availableSignals;
    const q = signalSearch.toLowerCase();
    return availableSignals.filter(s => s.toLowerCase().includes(q));
  }, [availableSignals, signalSearch]);

  // Table columns
  const logColumns: Column<SignalRow>[] = useMemo(() => [
    { key: 'row', header: '#', render: (r) => {
      const idx = rows.indexOf(r);
      return <span className="text-xs text-[var(--text-muted)] font-mono">{(page - 1) * perPage + idx + 1}</span>;
    }},
    { key: 'time', header: t('Timestamp'), render: (r) => <span className="whitespace-nowrap text-xs text-[var(--text-muted)]">{new Date(r.created_at).toLocaleString()}</span> },
    { key: 'signal', header: t('Signal'), render: (r) => {
      const idx = selectedSignals.indexOf(r.signal);
      return <span className="font-mono text-xs" style={{ color: idx >= 0 ? CHART_COLORS[idx % CHART_COLORS.length] : 'var(--text-primary)' }}>{r.signal}</span>;
    }},
    { key: 'value', header: t('Value'), render: (r) => <span className="font-mono text-xs text-[var(--text-primary)]">{formatValue(r)}</span> },
    { key: 'type', header: t('Type'), render: (r) => {
      const vt = valueType(r);
      return <Badge variant={typeVariant[vt] ?? 'neutral'} size="sm">{vt}</Badge>;
    }},
  ], [rows, page, perPage, selectedSignals, t]);

  return (
    <PageContainer
      title={t('Signal Log Viewer')}
      subtitle={t('Query signal history from Postgres')}
      loading={false}
    >
      {/* ── Controls ──────────────────────────────────────────────── */}
      <GlassPanel className="p-4 sm:p-5 space-y-4">
        {/* Signal picker */}
        <div>
          <span className="block text-xs font-medium uppercase tracking-wider mb-2 text-[var(--text-muted)]">
            <Filter className="inline h-3 w-3 mr-1" />{t('Signals')} ({selectedSignals.length})
          </span>
          <Input
            icon={<Search className="h-3.5 w-3.5" />}
            placeholder={t('Search signals…')}
            value={signalSearch}
            onChange={e => setSignalSearch(e.target.value)}
            className="mb-2"
          />
          {selectedSignals.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {selectedSignals.map((sig, i) => (
                <Badge
                  key={sig}
                  variant="info"
                  size="sm"
                  className="cursor-pointer"
                  style={{ borderColor: CHART_COLORS[i % CHART_COLORS.length], color: CHART_COLORS[i % CHART_COLORS.length] }}
                  onClick={() => toggleSignal(sig)}
                >
                  {sig} ×
                </Badge>
              ))}
            </div>
          )}
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {filteredSignals.slice(0, 100).map(sig => (
              <Button
                key={sig}
                size="sm"
                variant={selectedSignals.includes(sig) ? 'primary' : 'ghost'}
                onClick={() => toggleSignal(sig)}
                className="w-full text-left text-xs font-mono truncate justify-start"
              >
                {sig}
              </Button>
            ))}
          </div>
        </div>

        {/* DateTime range */}
        <div>
          <span className="block text-xs font-medium uppercase tracking-wider mb-2 text-[var(--text-muted)]">
            <Clock className="inline h-3 w-3 mr-1" />{t('Time Range')}
          </span>
          <div className="flex flex-wrap gap-2 mb-2">
            {PRESETS.map(p => (
              <Button key={p.label} size="sm" variant="ghost" onClick={() => applyPreset(p.hours)}>
                {p.label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label={t('From')} type="datetime-local" value={fromStr} onChange={e => setFromStr(e.target.value)} />
            <Input label={t('To')} type="datetime-local" value={toStr} onChange={e => setToStr(e.target.value)} />
          </div>
        </div>

        {/* Query controls */}
        <div className="flex items-center gap-3">
          <Select
            label={t('Per Page')}
            value={String(perPage)}
            onChange={e => { setPerPage(Number(e.target.value)); setPage(1); }}
            options={[
              { value: '25', label: '25' },
              { value: '50', label: '50' },
              { value: '100', label: '100' },
              { value: '500', label: '500' },
            ]}
            className="w-24"
          />
          <Button
            variant="primary"
            icon={<Database className="h-4 w-4" />}
            onClick={handleQuery}
            disabled={!canQuery}
            loading={isFetching}
            className="mt-5"
          >
            {t('Query')}
          </Button>
          {hasQueried && (
            <span className="text-xs text-[var(--text-muted)] mt-5">
              {totalRecords} {t('records')}
            </span>
          )}
        </div>
      </GlassPanel>

      {/* ── Results ───────────────────────────────────────────────── */}
      {!hasQueried ? (
        <EmptyState
          icon={<Database className="h-10 w-10" />}
          title={t('Select signals and click Query')}
          message={t('Choose one or more signals, set a date range, then hit Query to browse signal history.')}
        />
      ) : (
        <FadeIn>
          <GlassPanel className="p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="h-4 w-4 text-neon-cyan" />
              <span className="section-title">{t('Signal Data')}</span>
              <span className="ml-auto text-[10px] text-[var(--text-muted)]">
                {t('Page')} {page} · {totalRecords} {t('total')}
              </span>
            </div>

            {isLoading ? (
              <div className="space-y-2">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-8" />)}</div>
            ) : rows.length > 0 ? (
              <>
                <DataTable
                  columns={logColumns}
                  data={rows}
                  keyExtractor={(r) => `${r.created_at}-${r.signal}`}
                  compact
                />
                <Pagination
                  page={page}
                  pageSize={perPage}
                  total={totalRecords}
                  onPageChange={setPage}
                />
              </>
            ) : (
              <EmptyState
                icon={<Database className="h-8 w-8" />}
                title={t('No data')}
                message={t('No signal data found for this query.')}
              />
            )}
          </GlassPanel>
        </FadeIn>
      )}
    </PageContainer>
  );
}
