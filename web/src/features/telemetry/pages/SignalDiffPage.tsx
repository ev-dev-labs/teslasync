/**
 * SignalDiffPage — compare signal values between two snapshots in time.
 *
 * Refactored to compose the shared `SignalCompareControls` +
 * `SignalDiffTable`. The category-prefix list and date-presets now live
 * in `SignalCompareControls.tsx` so this page and the unified workspace
 * stay in lockstep.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { GitCompare, Bell, Pin, PinOff } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel, Select, CopyButton, Badge } from '@/components/ui';
import { StatCard, BulkActionsToolbar, SavedViewMenu } from '@/components/data-display';
import type { BulkAction } from '@/components/data-display/BulkActionsToolbar';
import { Skeleton } from '@/components/feedback';
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
import {
  SignalCompareControls,
  CATEGORY_PREFIXES,
  isoOrEmpty,
  toLocalDatetimeInput,
} from '../components/SignalCompareControls';

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
  const { data: diffResp, isLoading, error } = useSignalDiffServer(
    vehicleId,
    atAIso,
    atBIso,
    signalsCsv,
    { enabled: vehicleId > 0 && Boolean(atAIso) && Boolean(atBIso) },
  );

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
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SavedViewMenu route="/telemetry/signal-diff" currentQuery={currentQuery} onApply={apply} />
          {permalinkUrl ? (
            <CopyButton text={permalinkUrl} label={t('signalDiff.share', 'Share')} size="sm" />
          ) : null}
        </div>
      }
    >
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
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 md:items-end">
            <label className="space-y-1">
              <span className="block text-xs text-[var(--text-muted)]">{t('signalDiff.vehicle', 'Vehicle')}</span>
              <Select
                value={String(vehicleId || '')}
                onChange={(e) => setVehicleIdParam(Number(e.target.value))}
                options={vehicleOptions}
              />
            </label>
          </div>
        }
      />

      <FadeIn delay={0.05}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label={t('signalDiff.totalChanged', 'Changed signals')} value={isLoading ? '—' : String(allRows.length)} />
          <StatCard label={t('signalDiff.visible', 'Visible after filter')} value={isLoading ? '—' : String(filteredRows.length)} />
          <StatCard label={t('signalDiff.pinnedCount', 'Pinned')} value={String(pinnedSignals.size)} />
          <StatCard
            label={t('signalDiff.windowSpan', 'Window span')}
            value={atAIso && atBIso
              ? `${Math.abs(new Date(atBIso).getTime() - new Date(atAIso).getTime()) / 1000} s`
              : '—'}
          />
        </div>
      </FadeIn>

      <BulkActionsToolbar
        selectedIds={selectedSignals}
        total={filteredRows.length}
        onClear={() => setSelectedSignals([])}
        actions={bulkActions}
      />

      <FadeIn delay={0.1}>
        <GlassPanel className="p-4 sm:p-5">
          {error ? (
            <div className="rounded-md border border-rose-400/20 bg-rose-500/[0.05] p-3 text-sm text-rose-200">
              {t('signalDiff.error', 'Failed to load diff')}
            </div>
          ) : null}
          {isLoading && !diffResp ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={36} />)}
            </div>
          ) : allRows.length === 0 && !filterActive && atAIso && atBIso ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <GitCompare className="h-10 w-10 text-[var(--text-muted)] opacity-30" />
              <p className="text-sm text-[var(--text-muted)]">
                {t('signalDiff.noChanges', 'No signals changed between the two snapshots')}
              </p>
            </div>
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
          {pinnedSignals.size > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--border-subtle)] pt-3">
              <span className="text-xs text-[var(--text-muted)]">{t('signalDiff.pinnedLabel', 'Pinned:')}</span>
              {Array.from(pinnedSignals).sort().map((s) => (
                <Badge key={s} variant="neutral">{s}</Badge>
              ))}
            </div>
          ) : null}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
