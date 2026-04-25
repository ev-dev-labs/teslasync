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
import { AlertBanner } from '@/components/feedback';
import { getErrorMessage } from '@/lib/errorMessage';
import { Skeleton } from '@/components/feedback/Skeleton';
import { FadeIn } from '@/components/motion/FadeIn';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSignals } from '@/api/hooks/useTelemetry';
import { request } from '@/api/client';
import { CHART_COLORS } from '@/lib/colors';
import { toLocalDatetimeStr } from '@/lib/dateFormat';
import { formatValue } from '@/components/SignalQueryControls';
import { TIME_RANGE_PRESETS } from '@/lib/constants';
import { Database, Search, Clock, Activity, Filter, AlertCircle } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SignalRow {
  created_at: string;
  signal: string;
  value_num: number | null;
  value_str: string | null;
  value_bool: boolean | null;
}

interface SignalHistoryResp {
  signal: string;
  count: number;
  data: Array<{
    created_at: string;
    value_num?: number | null;
    value_str?: string | null;
    value_bool?: boolean | null;
  }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function valueType(row: SignalRow): string {
  if (row.value_num !== null && row.value_num !== undefined) return 'number';
  if (row.value_bool !== null && row.value_bool !== undefined) return 'boolean';
  return 'string';
}

const typeVariant: Record<string, 'info' | 'success' | 'warning'> = {
  number: 'info', string: 'success', boolean: 'warning',
};

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
  const [fromStr, setFromStr] = useState(() => toLocalDatetimeStr(new Date(Date.now() - 3600_000)));
  const [toStr, setToStr] = useState(() => toLocalDatetimeStr(new Date()));

  // Pagination
  const [perPage, setPerPage] = useState(50);
  const [page, setPage] = useState(1);

  // Query trigger — only fetch when user clicks "Query"
  const [queryKey, setQueryKey] = useState<number | null>(null);

  const applyPreset = useCallback((hours: number) => {
    const end = new Date();
    setFromStr(toLocalDatetimeStr(new Date(end.getTime() - hours * 3600_000)));
    setToStr(toLocalDatetimeStr(end));
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

  const fromIso = fromStr ? new Date(fromStr).toISOString() : '';
  const toIso = toStr ? new Date(toStr).toISOString() : '';

  // ── Data query (parallel per-signal fetches) ──
  const { data: allRows, isLoading, isFetching, error: dataError } = useQuery<SignalRow[]>({
    queryKey: ['signal-log', queryKey],
    queryFn: async () => {
      const results = await Promise.all(
        selectedSignals.map(sig =>
          request<SignalHistoryResp>(
            `/signals/${vehicleId}/${sig}/history?from=${fromIso}&to=${toIso}&limit=${perPage * 10}`,
          ),
        ),
      );
      return results.flatMap((resp) =>
        (resp?.data ?? []).map(row => ({
          created_at: row.created_at,
          signal: resp?.signal ?? '',
          value_num: row.value_num ?? null,
          value_str: row.value_str ?? null,
          value_bool: row.value_bool ?? null,
        })),
      ).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    },
    enabled: queryKey !== null,
  });

  const anyError = dataError as Error | undefined;

  const totalRecords = (allRows ?? []).length;
  const rows = useMemo(() => {
    const start = (page - 1) * perPage;
    return (allRows ?? []).slice(start, start + perPage);
  }, [allRows, page, perPage]);
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
      {anyError && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      )}

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
            {TIME_RANGE_PRESETS.map(p => (
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
        <div className="flex items-end gap-3">
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
          >
            {t('Query')}
          </Button>
          {hasQueried && (
            <span className="text-xs text-[var(--text-muted)]">
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
                  pagination={{ defaultPageSize: 50 }}
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
