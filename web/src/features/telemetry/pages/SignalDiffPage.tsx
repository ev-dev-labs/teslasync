/**
 * SignalDiffPage — compare signal values between two snapshots in time.
 *
 * Modern-UI full-width redesign: a compare-controls filter bar, a responsive
 * MetricCard KPI band, an aggregate "change analysis" bento
 * (`SignalDiffBreakdown`), a bulk-actions toolbar, and the row-level
 * `SignalDiffTable` as the full-width detail band.
 *
 * The category-prefix list and date-presets live in `SignalCompareControls`
 * so this page and the unified workspace stay in lockstep.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { GitCompare, Bell, Pin, PinOff, Filter, Layers, Clock, Sigma } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Select, CopyButton, PanelTitle, Text } from '@/components/ui';
import { MetricCard, BulkActionsToolbar, SavedViewMenu, type BulkAction } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  useSignals,
  useSignalDiffServer,
  type SignalDiffRow,
} from '@/api/hooks/useTelemetry';
import { useVehicles } from '@/api/hooks/useVehicles';
import { usePinned, useTogglePin } from '@/api/hooks/usePinned';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import { useUrlNumber, useUrlString } from '@/hooks/useUrlState';
import { downloadCSV, objectsToCSV } from '@/lib/csvExport';

import { SignalDiffTable } from '../components/SignalDiffTable';
import { SignalDiffBreakdown } from '../components/SignalDiffBreakdown';
import {
  SignalCompareControls,
  CATEGORY_PREFIXES,
  isoOrEmpty,
  toLocalDatetimeInput,
} from '../components/SignalCompareControls';

/** Coerce an arbitrary signal value to a finite number, or null when it isn't one. */
export function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  return null;
}

/** Compact human span (e.g. "1h 5m", "45s") for the window-span KPI. */
export function formatSpan(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    const rem = s % 60;
    return rem ? `${m}m ${rem}s` : `${m}m`;
  }
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM ? `${h}h ${remM}m` : `${h}h`;
}

export default function SignalDiffPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePageTitle(t('signalDiff.title', 'Signal Diff'));
  const { currentQuery, apply } = useSavedViewUrl();

  // Vehicle picker — kept page-local (not the global VehicleSelect) so
  // saved views can pin to a specific car independent of global selection.
  const { data: vehicles } = useVehicles();
  const [vehicleIdParam, setVehicleIdParam] = useUrlNumber('vehicle', 0);
  const vehicleId = vehicleIdParam || vehicles?.[0]?.id || 0;

  useEffect(() => {
    if (!vehicleIdParam && vehicles && vehicles.length > 0) {
      setVehicleIdParam(vehicles[0].id);
    }
  }, [vehicleIdParam, vehicles, setVehicleIdParam]);

  // Window inputs (URL-synced)
  const defaultAtA = useMemo(
    () => toLocalDatetimeInput(new Date(Date.now() - 3600 * 1000)),
    [],
  );
  const defaultAtB = useMemo(() => toLocalDatetimeInput(new Date()), []);
  const [atA, setAtA] = useUrlString('a', defaultAtA);
  const [atB, setAtB] = useUrlString('b', defaultAtB);

  // Filters
  const [signalFilter, setSignalFilter] = useUrlString('q', '');
  const [activeCategoryRaw, setActiveCategoryRaw] = useUrlString('cat', '');
  const activeCategory = activeCategoryRaw || null;
  const setActiveCategory = useCallback(
    (next: string | null) => setActiveCategoryRaw(next ?? ''),
    [setActiveCategoryRaw],
  );

  // Selection state
  const [selectedSignals, setSelectedSignals] = useState<string[]>([]);

  // Pinned-signal state via pinned_items (item_type='widget')
  const pinContext = `signal-diff:vehicle:${vehicleId}`;
  const { data: pinnedItems = [] } = usePinned('widget', pinContext);
  const pinnedSignals = useMemo(() => {
    const set = new Set<string>();
    for (const p of pinnedItems) {
      if (p.item_id?.startsWith('signal:')) {
        set.add(p.item_id.slice('signal:'.length));
      }
    }
    return set;
  }, [pinnedItems]);
  const togglePin = useTogglePin('widget');

  // Available signals for the diff fetch
  const { data: availableSignals } = useSignals(vehicleId);
  const signalsCsv = useMemo(
    () => (availableSignals && availableSignals.length > 0 ? availableSignals.join(',') : ''),
    [availableSignals],
  );

  // Server-side diff
  const atAIso = isoOrEmpty(atA);
  const atBIso = isoOrEmpty(atB);
  const diffQuery = useSignalDiffServer(
    vehicleId,
    atAIso,
    atBIso,
    signalsCsv,
    { enabled: vehicleId > 0 && Boolean(atAIso) && Boolean(atBIso) },
  );
  const { data: diffResp, isLoading, error, refetch } = diffQuery;

  const allRows: SignalDiffRow[] = diffResp?.data ?? [];
  const filteredRows = useMemo(() => {
    let rows = allRows;
    if (signalFilter.trim()) {
      const needle = signalFilter.trim().toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(needle));
    }
    if (activeCategory) {
      const cat = CATEGORY_PREFIXES.find((c) => c.id === activeCategory);
      if (cat) rows = rows.filter((r) => cat.matches(r.name));
    }
    return rows;
  }, [allRows, signalFilter, activeCategory]);
  const filterActive = signalFilter.trim().length > 0 || activeCategory != null;
  const initialLoading = isLoading && !diffResp;
  // A failed diff must not read as "0 changed / 0 numeric / 0 categories" in the
  // KPI band — that silently reports "nothing changed" for what is actually an
  // error, which is dangerous on an incident-response surface. When the diff is
  // untrustworthy (initial load or error) the diff-derived metrics show "—",
  // mirroring the table + breakdown, which both switch to their error/loading
  // UI. Pinned count and window span come from independent sources (the pinned
  // query and the date inputs) so they stay visible regardless.
  const metricsUnavailable = initialLoading || Boolean(error);

  // Derived KPI metrics (from the already-fetched rows — no extra hooks).
  const numericChanges = useMemo(
    () =>
      filteredRows.reduce((acc, r) => {
        const a = toNum(r.value_a);
        const b = toNum(r.value_b);
        return acc + (a !== null && b !== null && a !== b ? 1 : 0);
      }, 0),
    [filteredRows],
  );
  const categoriesAffected = useMemo(
    () => CATEGORY_PREFIXES.filter((c) => filteredRows.some((r) => c.matches(r.name))).length,
    [filteredRows],
  );
  const windowSpanLabel = useMemo(() => {
    if (!atAIso || !atBIso) return '—';
    const spanSec = Math.abs(new Date(atBIso).getTime() - new Date(atAIso).getTime()) / 1000;
    return formatSpan(spanSec);
  }, [atAIso, atBIso]);

  // Bulk actions
  const bulkActions: BulkAction[] = useMemo(
    () => [
      {
        id: 'pin',
        label: t('signalDiff.bulk.pin', 'Pin selected'),
        icon: <Pin className="h-3.5 w-3.5" />,
        onClick: async (ids) => {
          for (const id of ids) {
            const name = String(id);
            if (pinnedSignals.has(name)) continue;
            await togglePin.mutateAsync({ itemId: `signal:${name}`, context: pinContext, pin: true });
          }
        },
      },
      {
        id: 'unpin',
        label: t('signalDiff.bulk.unpin', 'Unpin selected'),
        icon: <PinOff className="h-3.5 w-3.5" />,
        onClick: async (ids) => {
          for (const id of ids) {
            const name = String(id);
            if (!pinnedSignals.has(name)) continue;
            await togglePin.mutateAsync({ itemId: `signal:${name}`, context: pinContext, pin: false });
          }
        },
      },
      {
        id: 'csv',
        label: t('signalDiff.bulk.csv', 'Copy CSV'),
        onClick: async (ids) => {
          const idSet = new Set(ids.map(String));
          const rowsToExport = filteredRows.filter((r) => idSet.has(r.name));
          const csv = objectsToCSV(
            rowsToExport.map((r) => ({
              signal: r.name,
              window_a: String(r.value_a ?? ''),
              window_b: String(r.value_b ?? ''),
              source_a: String(r.source_a ?? ''),
              source_b: String(r.source_b ?? ''),
            })),
          );
          downloadCSV(`signal-diff-vehicle-${vehicleId}.csv`, csv);
        },
      },
      {
        id: 'alert',
        label: t('signalDiff.bulk.addAlert', 'Add as alert rule'),
        icon: <Bell className="h-3.5 w-3.5" />,
        onClick: async (ids) => {
          const csv = ids.map(String).join(',');
          navigate(`/alert-studio?signals=${encodeURIComponent(csv)}&from=signal-diff`);
        },
      },
    ],
    [filteredRows, navigate, pinContext, pinnedSignals, togglePin, vehicleId, t],
  );

  // Permalink
  const permalinkUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}${window.location.pathname}?${currentQuery}`;
  }, [currentQuery]);

  const vehicleOptions = useMemo(
    () => (vehicles ?? []).map((v) => ({ value: String(v.id), label: v.display_name || v.vin })),
    [vehicles],
  );

  return (
    <PageContainer
      title={t('signalDiff.title', 'Signal Diff')}
      subtitle={t('signalDiff.subtitle', 'Compare signal values between two snapshots in time')}
      query={diffQuery}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SavedViewMenu route="/telemetry/signal-diff" currentQuery={currentQuery} onApply={apply} />
          {permalinkUrl ? (
            <CopyButton text={permalinkUrl} label={t('signalDiff.share', 'Share')} size="sm" />
          ) : null}
        </div>
      }
    >
      {/* 1 — Compare controls (filter bar): vehicle picker, windows, presets, filters */}
      <SignalCompareControls
        atA={atA}
        atB={atB}
        onChangeA={setAtA}
        onChangeB={setAtB}
        search={signalFilter}
        onSearchChange={setSignalFilter}
        category={activeCategory}
        onCategoryChange={setActiveCategory}
        topSlot={
          <div className="grid grid-cols-1 gap-2 sm:max-w-xs">
            <label className="space-y-1">
              <Text as="span" variant="caption" className="mb-1 block">
                {t('signalDiff.vehicle', 'Vehicle')}
              </Text>
              <Select
                value={String(vehicleId || '')}
                onChange={(e) => setVehicleIdParam(Number(e.target.value))}
                options={vehicleOptions}
              />
            </label>
          </div>
        }
      />

      {/* 2 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section
          aria-label={t('signalDiff.kpisLabel', 'Diff summary')}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6"
        >
          <MetricCard
            label={t('signalDiff.totalChanged', 'Changed signals')}
            value={metricsUnavailable ? '—' : allRows.length}
            icon={<GitCompare className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('signalDiff.visible', 'Visible after filter')}
            value={metricsUnavailable ? '—' : filteredRows.length}
            icon={<Filter className="h-5 w-5" />}
            color="blue"
          />
          <MetricCard
            label={t('signalDiff.numericChanges', 'Numeric changes')}
            value={metricsUnavailable ? '—' : numericChanges}
            icon={<Sigma className="h-5 w-5" />}
            color="green"
          />
          <MetricCard
            label={t('signalDiff.categoriesAffected', 'Categories affected')}
            value={metricsUnavailable ? '—' : categoriesAffected}
            icon={<Layers className="h-5 w-5" />}
            color="purple"
          />
          <MetricCard
            label={t('signalDiff.pinnedCount', 'Pinned')}
            value={pinnedSignals.size}
            icon={<Pin className="h-5 w-5" />}
            color="amber"
          />
          <MetricCard
            label={t('signalDiff.windowSpan', 'Window span')}
            value={windowSpanLabel}
            icon={<Clock className="h-5 w-5" />}
            color="cyan"
          />
        </section>
      </FadeIn>

      {/* 3 — Change analysis bento: category + source-layer + pinned breakdowns */}
      <FadeIn delay={0.1}>
        <SignalDiffBreakdown
          rows={filteredRows}
          loading={initialLoading}
          error={error}
          onRetry={() => refetch()}
          pinnedSignals={pinnedSignals}
        />
      </FadeIn>

      {/* 4 — Bulk actions (sticky) for the current table selection */}
      <BulkActionsToolbar
        selectedIds={selectedSignals}
        total={filteredRows.length}
        onClear={() => setSelectedSignals([])}
        actions={bulkActions}
      />

      {/* 5 — Diff table: full-width detail band with its own states */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('signalDiff.tableTitle', 'Signal differences')}
          </PanelTitle>
          {error ? (
            <QueryError error={error} onRetry={() => refetch()} />
          ) : initialLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={36} />)}
            </div>
          ) : allRows.length === 0 && !filterActive && atAIso && atBIso ? (
            <EmptyState
              icon={<GitCompare className="h-10 w-10" aria-hidden="true" />}
              message={t('signalDiff.noChanges', 'No signals changed between the two snapshots')}
            />
          ) : (
            <SignalDiffTable
              rows={filteredRows}
              vehicleId={vehicleId}
              loading={false}
              filterActive={filterActive}
              selectedSignals={selectedSignals}
              onSelectionChange={setSelectedSignals}
              pinnedSignals={pinnedSignals}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
