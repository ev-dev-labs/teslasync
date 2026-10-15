/**
 * SignalDiffPage — compare signal values between two snapshots in time.
 *
 * Modern-UI full-width redesign: a compare-controls filter bar, a responsive
 * OperationalBrief KPI band, an aggregate "change analysis" bento
 * (`SignalDiffBreakdown`), a bulk-actions toolbar, and the row-level
 * `SignalDiffTable` as the full-width detail band.
 *
 * The category-prefix list and date-presets live in `SignalCompareControls`
 * so this page and the unified workspace stay in lockstep.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { GitCompare, Bell, Pin, PinOff } from 'lucide-react';

import { PageLayout } from '@/components/layout';
import { GlassPanel, Select, CopyButton, PanelTitle, Text, HelpTooltip, Icon } from '@/components/ui';
import { BulkActionsToolbar, SavedViewMenu, type BulkAction, type StatMetric } from '@/components/data-display';
import { TelemetrySummaryBrief } from '../components/operationalbrief-all/TelemetrySummaryBrief';
import { Skeleton, EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  useSignals,
  useSignalDiffServer,
  type SignalDiffRow,
} from '@/api/hooks/useTelemetry';
import { useVehicles } from '@/api/hooks/useVehicles';
import { usePinned, useTogglePin } from '@/api/hooks/usePinned';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import { useUrlBatch, useUrlNumber, useUrlString } from '@/hooks/useUrlState';
import { downloadCSV, objectsToCSV, type CsvCellValue } from '@/lib/csvExport';
import { typography } from '@/lib/tokens';

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

function csvValue(value: unknown): CsvCellValue {
  if (value == null || typeof value === 'string' || typeof value === 'number' ||
      typeof value === 'boolean' || typeof value === 'object') return value;
  throw new TypeError('Unsupported signal value for CSV export');
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
  usePageTitle(t('signalDiff.title', 'Signal diff'));
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
  const setUrlBatch = useUrlBatch();
  const [signalFilter, setSignalFilter] = useUrlString('q', '');
  const [activeCategoryRaw, setActiveCategoryRaw] = useUrlString('cat', '');
  const activeCategory = activeCategoryRaw || null;
  const setActiveCategory = useCallback(
    (next: string | null) => setActiveCategoryRaw(next ?? ''),
    [setActiveCategoryRaw],
  );

  // Pinned-signal state via pinned_items (item_type='widget')
  const pinContext = `signal-diff:vehicle:${vehicleId}`;
  const pinnedQuery = usePinned('widget', pinContext);
  const { data: pinnedItems = [] } = pinnedQuery;
  const pinnedState = useDataState(pinnedQuery);
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
  // Filters change visibility, not the identity of the selected comparison.
  const selectionScope = JSON.stringify([vehicleId, atAIso || atA, atBIso || atB]);
  const scopeIdentity = useMemo(() => Symbol(selectionScope), [selectionScope]);
  const currentScope = useRef<symbol | null>(scopeIdentity);
  useLayoutEffect(() => {
    currentScope.current = scopeIdentity;
    return () => { currentScope.current = null; };
  }, [scopeIdentity]);
  const [selection, setSelection] = useState({ scope: selectionScope, signals: [] as string[] });
  if (selection.scope !== selectionScope) {
    setSelection({ scope: selectionScope, signals: [] });
  }
  const selectedSignals = selection.scope === selectionScope ? selection.signals : [];
  const setSelectedSignals = useCallback((signals: string[]) => {
    setSelection({ scope: selectionScope, signals });
  }, [selectionScope]);
  const prerequisitesReady = vehicleId > 0 && Boolean(atAIso) && Boolean(atBIso);
  const diffQuery = useSignalDiffServer(
    vehicleId,
    atAIso,
    atBIso,
    signalsCsv,
    { enabled: prerequisitesReady },
  );
  const { data: diffResp, isLoading, refetch } = diffQuery;
  const diffState = useDataState(diffQuery, { provenance: 'historical' });

  const allRows: SignalDiffRow[] = diffResp?.data ?? [];
  useEffect(() => {
    if (!prerequisitesReady || diffResp == null || diffQuery.isPlaceholderData) return;
    const names = new Set((diffResp.data ?? []).map((row) => row.name));
    setSelection((previous) => {
      if (previous.scope !== selectionScope) return previous;
      const signals = previous.signals.filter((name) => names.has(name));
      return signals.length === previous.signals.length ? previous : { ...previous, signals };
    });
  }, [diffResp, diffQuery.isPlaceholderData, prerequisitesReady, selectionScope]);
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
  const initialLoading = prerequisitesReady && !diffState.hasData &&
    diffQuery.fetchStatus !== 'paused' && (diffQuery.isFetching || isLoading);
  const diffUnknown = !prerequisitesReady || (!diffState.hasData && !initialLoading && !diffState.fatalError);
  const pinnedLoading = vehicleId > 0 && !pinnedState.hasData &&
    pinnedQuery.fetchStatus !== 'paused' && (pinnedQuery.isFetching || pinnedQuery.isLoading);
  // Unknown and failed comparisons are not confirmed zero changes.
  // Pins and snapshot span remain independent of the diff source.
  const metricsUnavailable = diffUnknown || initialLoading || diffState.fatalError != null;

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
  const changePins = useCallback(async (ids: Array<string | number>, pin: boolean) => {
    const submittedSelection = selection;
    for (const id of ids) {
      // An in-flight mutation keeps its original target, but no further writes
      // or selection resets belong to a comparison the user has left.
      if (currentScope.current !== scopeIdentity) return;
      const name = String(id);
      if (pinnedSignals.has(name) === pin) continue;
      await togglePin.mutateAsync({ itemId: `signal:${name}`, context: pinContext, pin });
    }
    if (currentScope.current !== scopeIdentity) return;
    setSelection((previous) => previous === submittedSelection
      ? { ...previous, signals: [] }
      : previous);
  }, [selection, scopeIdentity, pinnedSignals, togglePin, pinContext]);
  const bulkActions: BulkAction[] = useMemo(
    () => [
      {
        id: 'pin',
        label: t('signalDiff.bulk.pin', 'Pin selected'),
        icon: <Icon icon={Pin} size="sm" />,
        onClick: (ids) => changePins(ids, true),
      },
      {
        id: 'unpin',
        label: t('signalDiff.bulk.unpin', 'Unpin selected'),
        icon: <Icon icon={PinOff} size="sm" />,
        onClick: (ids) => changePins(ids, false),
      },
      {
        id: 'csv',
        label: t('signalDiff.bulk.csv', 'Download CSV'),
        onClick: async (ids) => {
          const idSet = new Set(ids.map(String));
          const rowsToExport = allRows.filter((r) => idSet.has(r.name));
          const csv = objectsToCSV(
            rowsToExport.map((r) => ({
              signal: r.name,
              window_a: csvValue(r.value_a),
              window_b: csvValue(r.value_b),
              source_a: r.source_a,
              source_b: r.source_b,
            })),
          );
          downloadCSV(`signal-diff-vehicle-${vehicleId}.csv`, csv);
        },
      },
      {
        id: 'alert',
        label: t('signalDiff.bulk.addAlert', 'Add as alert rule'),
        icon: <Icon icon={Bell} size="sm" />,
        onClick: async (ids) => {
          const csv = ids.map(String).join(',');
          navigate(`/alert-studio?signals=${encodeURIComponent(csv)}&from=signal-diff`);
        },
      },
    ],
    [allRows, navigate, changePins, vehicleId, t],
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
  const rawWindowSpan = atAIso && atBIso
    ? Math.abs(Date.parse(atBIso) - Date.parse(atAIso)) / 1000 : null;
  const metrics: readonly StatMetric[] = [
    ...([
      ['changed', 'signalDiff.totalChanged', 'Changed signals', allRows.length],
      ['visible', 'signalDiff.visible', 'Visible after filter', filteredRows.length],
      ['numeric', 'signalDiff.numericChanges', 'Numeric changes', numericChanges],
      ['categories', 'signalDiff.categoriesAffected', 'Categories affected', categoriesAffected],
    ] as const).map(([key, labelKey, label, raw]): StatMetric => ({
      metricId: 'count', occurrenceId: key, rawValue: metricsUnavailable || diffResp == null ? null : raw,
      label: t(labelKey, label),
      description: key === 'changed'
        ? t('telemetry.brief.diffAllRows', 'All returned changed rows before name and category filters.')
        : t('telemetry.brief.diffFiltered', 'Returned changed rows after the current name and category filters; numeric changes retain the existing value coercion.'),
    })),
    { metricId: 'count', occurrenceId: 'pinned', rawValue: vehicleId <= 0 || pinnedQuery.data == null ? null : pinnedSignals.size,
      label: t('signalDiff.pinnedCount', 'Pinned'),
      description: t('telemetry.brief.pinSource', 'Independent saved pins for this vehicle; not limited to visible diff rows.'),
      context: pinnedState.refreshError || pinnedState.status === 'stale'
        ? t('operationalSummary.retained', 'Retained source data')
        : pinnedState.fatalError ? t('operationalSummary.unavailable', 'Source unavailable') : undefined },
    { metricId: 'duration', occurrenceId: 'window-span', rawValue: rawWindowSpan,
      label: t('signalDiff.windowSpan', 'Window span'),
      display: { formatter: () => ({ value: windowSpanLabel, unit: '' }) },
      description: t('telemetry.brief.diffWindow', 'Absolute time between the two snapshot inputs; not a sample coverage duration.'),
      context: `${atAIso || '—'} → ${atBIso || '—'}` },
  ];

  return (
    <PageLayout
      title={t('signalDiff.title', 'Signal diff')}
      subtitle={t('signalDiff.subtitle', 'Compare signal values between two snapshots in time')}
      query={diffQuery}
      overflowActions={
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
        <TelemetrySummaryBrief title={t('signalDiff.kpisLabel', 'Diff summary')}
          metrics={metrics} testId="signal-diff-page-summary"
          unavailable={diffState.fatalError != null} unknown={diffUnknown} sourceStatus={diffState.status}
          retained={diffResp != null && (diffState.isRefreshing || diffState.status === 'stale' || diffState.refreshError != null)}
          statusLabel={initialLoading ? t('operationalSummary.loading', 'Loading sources') : undefined}
          scope={`${atAIso || '—'} → ${atBIso || '—'}`}
          provenance={t('telemetry.brief.diffProvenance', 'Server snapshot diff; independent saved-pin query and local snapshot inputs')}
          description={t('telemetry.brief.diffScope', 'Changed-row counts describe the returned comparison. Filtered counts, saved pins, and the snapshot input span have independent scopes.')} />
      </FadeIn>

      {/* 3 — Change analysis bento: category + source-layer + pinned breakdowns */}
      <StaleRefreshWarning state={diffState} label={t('signalDiff.tableTitle', 'Signal differences')} />
      <FadeIn delay={0.1}>
        <SignalDiffBreakdown
          rows={filteredRows}
          loading={initialLoading}
          unknown={diffUnknown}
          diffState={diffState}
          pinnedState={pinnedState}
          pinnedLoading={pinnedLoading}
          pinnedUnknown={vehicleId <= 0}
          error={diffState.fatalError}
          onRetry={() => refetch()}
          filterActive={filterActive}
          onClearFilters={() => setUrlBatch({ q: null, cat: null })}
          pinnedSignals={pinnedSignals}
        />
      </FadeIn>

      {/* 4 — Bulk actions (sticky) for the current table selection */}
      <BulkActionsToolbar
        key={selectionScope}
        selectedIds={selectedSignals}
        selectionScope="selected"
        total={allRows.length}
        onClear={() => setSelectedSignals([])}
        actions={bulkActions}
      />

      {/* 5 — Diff table: full-width detail band with its own states */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Icon icon={GitCompare} className={typography.color.muted} />
            {t('signalDiff.tableTitle', 'Signal differences')}
            <HelpTooltip
              i18nKey="help.signal.diff"
              defaultValue="Server-side comparison between two snapshots. Unchanged signals are omitted from the result to reduce noise."
              ariaLabel={t('signalDiff.tableTitle', 'Signal differences')}
            />
          </PanelTitle>
          {diffState.fatalError ? (
            <QueryError error={diffState.fatalError} onRetry={() => refetch()} />
          ) : initialLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={36} />)}
            </div>
          ) : diffUnknown ? (
            <Text color="muted">{t('common.unknown', 'Unknown')}</Text>
          ) : allRows.length === 0 && !filterActive ? (
            // no-action: this branch is explicitly gated on !filterActive — filters are confirmed off, so it is genuinely zero diffs, not a filtered-away result.
            <EmptyState
              icon={<Icon icon={GitCompare} className="h-10 w-10" />}
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
    </PageLayout>
  );
}
