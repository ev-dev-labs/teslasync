import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { GitCompare, Bell, Pin, PinOff } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel, Button, Input, Select, CopyButton, Badge } from '@/components/ui';
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
import { downloadCSV, objectsToCSV } from '@/lib/csvExport';
import { cn } from '@/lib/cn';
import { SignalDiffTable } from '../components/SignalDiffTable';

/* ────────────────────────────────────────────────────────────── */
/*  Helpers — local datetime <-> ISO conversions                   */
/* ────────────────────────────────────────────────────────────── */

function toLocalDatetimeInput(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isoOrEmpty(localValue: string): string {
  if (!localValue) return '';
  const d = new Date(localValue);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/* ────────────────────────────────────────────────────────────── */
/*  Category chips — derived from signal-name prefixes             */
/* ────────────────────────────────────────────────────────────── */

const CATEGORY_PREFIXES: Array<{ id: string; labelKey: string; defaultLabel: string; matches: (name: string) => boolean }> = [
  {
    id: 'battery',
    labelKey: 'signalDiff.cat.battery',
    defaultLabel: 'Battery',
    matches: (n) => /battery|charge|soc|range|kwh/i.test(n),
  },
  {
    id: 'drive',
    labelKey: 'signalDiff.cat.drive',
    defaultLabel: 'Drive',
    matches: (n) => /speed|odometer|gear|drive|brake|throttle|steering/i.test(n),
  },
  {
    id: 'climate',
    labelKey: 'signalDiff.cat.climate',
    defaultLabel: 'Climate',
    matches: (n) => /climate|hvac|cabin|seat|temp/i.test(n),
  },
  {
    id: 'security',
    labelKey: 'signalDiff.cat.security',
    defaultLabel: 'Security',
    matches: (n) => /lock|sentry|alarm|valet|guard/i.test(n),
  },
  {
    id: 'motor',
    labelKey: 'signalDiff.cat.motor',
    defaultLabel: 'Motor',
    matches: (n) => /motor|inverter|torque|rpm/i.test(n),
  },
  {
    id: 'tire',
    labelKey: 'signalDiff.cat.tire',
    defaultLabel: 'Tire',
    matches: (n) => /tpms|tire|pressure/i.test(n),
  },
  {
    id: 'media',
    labelKey: 'signalDiff.cat.media',
    defaultLabel: 'Media',
    matches: (n) => /media|audio|volume|playback/i.test(n),
  },
  {
    id: 'safety',
    labelKey: 'signalDiff.cat.safety',
    defaultLabel: 'Safety',
    matches: (n) => /airbag|seatbelt|fcw|aeb|safety/i.test(n),
  },
];

/* ────────────────────────────────────────────────────────────── */
/*  Date presets                                                   */
/* ────────────────────────────────────────────────────────────── */

type PresetId =
  | 'now-vs-1h'
  | 'now-vs-1d'
  | 'last-drive'
  | 'before-after-charge'
  | 'today-vs-yesterday';

interface DatePreset {
  id: PresetId;
  labelKey: string;
  defaultLabel: string;
  compute: () => { atA: Date; atB: Date };
}

const PRESETS: DatePreset[] = [
  {
    id: 'now-vs-1h',
    labelKey: 'signalDiff.preset.nowVs1h',
    defaultLabel: 'Now vs 1h ago',
    compute: () => {
      const now = new Date();
      return { atA: new Date(now.getTime() - 3600 * 1000), atB: now };
    },
  },
  {
    id: 'now-vs-1d',
    labelKey: 'signalDiff.preset.nowVs1d',
    defaultLabel: 'Now vs 1 day ago',
    compute: () => {
      const now = new Date();
      return { atA: new Date(now.getTime() - 86400 * 1000), atB: now };
    },
  },
  {
    id: 'before-after-charge',
    labelKey: 'signalDiff.preset.beforeAfterCharge',
    defaultLabel: 'Before vs after last charge',
    compute: () => {
      const now = new Date();
      // Best-effort approximation; the page will hint users to pick exact times when needed.
      return { atA: new Date(now.getTime() - 4 * 3600 * 1000), atB: now };
    },
  },
  {
    id: 'last-drive',
    labelKey: 'signalDiff.preset.lastDrive',
    defaultLabel: 'Last drive start vs end',
    compute: () => {
      const now = new Date();
      return { atA: new Date(now.getTime() - 90 * 60 * 1000), atB: new Date(now.getTime() - 5 * 60 * 1000) };
    },
  },
  {
    id: 'today-vs-yesterday',
    labelKey: 'signalDiff.preset.todayVsYesterday',
    defaultLabel: 'Today vs yesterday (same time)',
    compute: () => {
      const now = new Date();
      return { atA: new Date(now.getTime() - 86400 * 1000), atB: now };
    },
  },
];

/* ────────────────────────────────────────────────────────────── */
/*  Page                                                           */
/* ────────────────────────────────────────────────────────────── */

export default function SignalDiffPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePageTitle(t('signalDiff.title', 'Signal Diff'));
  const { currentQuery, apply } = useSavedViewUrl();

  /* ─── Vehicle picker ─── */
  const { data: vehicles } = useVehicles();
  const initialVehicleId = useMemo(() => {
    const fromQs = new URLSearchParams(window.location.search).get('vehicle');
    if (fromQs) return Number(fromQs);
    return vehicles?.[0]?.id ?? 0;
  }, [vehicles]);
  const [vehicleId, setVehicleId] = useState<number>(initialVehicleId);

  useEffect(() => {
    // When the vehicles list arrives later, hydrate our default vehicleId.
    if (!vehicleId && vehicles && vehicles.length > 0) {
      setVehicleId(vehicles[0].id);
    }
  }, [vehicleId, vehicles]);

  /* ─── Window inputs ─── */
  const now = new Date();
  const [atA, setAtA] = useState<string>(() =>
    toLocalDatetimeInput(new Date(now.getTime() - 3600 * 1000)),
  );
  const [atB, setAtB] = useState<string>(() => toLocalDatetimeInput(now));

  const applyPreset = useCallback((id: PresetId) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    const { atA: a, atB: b } = preset.compute();
    setAtA(toLocalDatetimeInput(a));
    setAtB(toLocalDatetimeInput(b));
  }, []);

  /* ─── Filters ─── */
  const [signalFilter, setSignalFilter] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  /* ─── Selection state ─── */
  const [selectedSignals, setSelectedSignals] = useState<string[]>([]);

  /* ─── Pinned-signal state via pinned_items (item_type='widget') ─── */
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

  /* ─── Available signals catalog (for the filter chips) ─── */
  const { data: availableSignals } = useSignals(vehicleId);
  const signalsCsv = useMemo(() => {
    if (!availableSignals || availableSignals.length === 0) return '';
    return availableSignals.join(',');
  }, [availableSignals]);

  /* ─── Server-side diff hook ─── */
  const atAIso = isoOrEmpty(atA);
  const atBIso = isoOrEmpty(atB);
  const { data: diffResp, isLoading, error } = useSignalDiffServer(
    vehicleId,
    atAIso,
    atBIso,
    signalsCsv,
    { enabled: vehicleId > 0 && Boolean(atAIso) && Boolean(atBIso) },
  );

  /* ─── Filtered rows ─── */
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

  /* ─── Permalink + saved view sync ─── */
  useEffect(() => {
    const params = new URLSearchParams();
    if (vehicleId) params.set('vehicle', String(vehicleId));
    if (atA) params.set('a', atA);
    if (atB) params.set('b', atB);
    if (signalFilter) params.set('q', signalFilter);
    if (activeCategory) params.set('cat', activeCategory);
    apply(params.toString());
  }, [vehicleId, atA, atB, signalFilter, activeCategory, apply]);

  const handleApplyView = useCallback(
    (q: string) => {
      const params = new URLSearchParams(q);
      const v = params.get('vehicle');
      const a = params.get('a');
      const b = params.get('b');
      const fq = params.get('q');
      const cat = params.get('cat');
      if (v) setVehicleId(Number(v));
      if (a) setAtA(a);
      if (b) setAtB(b);
      setSignalFilter(fq ?? '');
      setActiveCategory(cat ?? null);
    },
    [],
  );

  /* ─── Bulk actions ─── */
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
            await togglePin.mutateAsync({
              itemId: `signal:${name}`,
              context: pinContext,
              pin: true,
            });
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
            await togglePin.mutateAsync({
              itemId: `signal:${name}`,
              context: pinContext,
              pin: false,
            });
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

  /* ─── Permalink/copy URL ─── */
  const permalinkUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}${window.location.pathname}?${currentQuery}`;
  }, [currentQuery]);

  /* ─── Vehicle options ─── */
  const vehicleOptions = useMemo(
    () => (vehicles ?? []).map((v) => ({ value: String(v.id), label: v.display_name || v.vin })),
    [vehicles],
  );

  return (
    <PageContainer
      title={t('signalDiff.title', 'Signal Diff')}
      subtitle={t('signalDiff.subtitle', 'Compare signal values between two snapshots in time')}
      actions={
        <div className="flex items-center gap-2">
          <SavedViewMenu
            route="/telemetry/signal-diff"
            currentQuery={currentQuery}
            onApply={handleApplyView}
          />
          {permalinkUrl ? (
            <CopyButton text={permalinkUrl} label={t('signalDiff.share', 'Share')} size="sm" />
          ) : null}
        </div>
      }
    >
      {/* ─── Inputs ─── */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <span className="mb-1.5 block text-xs text-[var(--text-muted)]">
                {t('signalDiff.vehicle', 'Vehicle')}
              </span>
              <Select
                value={String(vehicleId || '')}
                onChange={(e) => setVehicleId(Number(e.target.value))}
                options={vehicleOptions}
              />
            </div>
            <div>
              <span className="mb-1.5 block text-xs text-cyan-300">
                {t('signalDiff.windowA', 'Window A')}
              </span>
              <Input type="datetime-local" value={atA} onChange={(e) => setAtA(e.target.value)} />
            </div>
            <div>
              <span className="mb-1.5 block text-xs text-amber-300">
                {t('signalDiff.windowB', 'Window B')}
              </span>
              <Input type="datetime-local" value={atB} onChange={(e) => setAtB(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--text-muted)]">
              {t('signalDiff.presetsLabel', 'Quick presets:')}
            </span>
            {PRESETS.map((p) => (
              <Button key={p.id} variant="secondary" size="sm" onClick={() => applyPreset(p.id)}>
                {t(p.labelKey, p.defaultLabel)}
              </Button>
            ))}
          </div>

          <div className="flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 items-center gap-2">
              <Input
                type="search"
                placeholder={t('signalDiff.filterPlaceholder', 'Filter signals…')}
                value={signalFilter}
                onChange={(e) => setSignalFilter(e.target.value)}
                className="max-w-sm"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {CATEGORY_PREFIXES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() =>
                    setActiveCategory((prev) => (prev === c.id ? null : c.id))
                  }
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-wide transition-colors',
                    activeCategory === c.id
                      ? 'border-blue-400/40 bg-blue-500/15 text-blue-200'
                      : 'border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]',
                  )}
                >
                  {t(c.labelKey, c.defaultLabel)}
                </button>
              ))}
              {activeCategory ? (
                <Button variant="ghost" size="sm" onClick={() => setActiveCategory(null)}>
                  {t('signalDiff.clearCategory', 'Clear')}
                </Button>
              ) : null}
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ─── Stats ─── */}
      <FadeIn delay={0.05}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label={t('signalDiff.totalChanged', 'Changed signals')}
            value={isLoading ? '—' : String(allRows.length)}
          />
          <StatCard
            label={t('signalDiff.visible', 'Visible after filter')}
            value={isLoading ? '—' : String(filteredRows.length)}
          />
          <StatCard
            label={t('signalDiff.pinnedCount', 'Pinned')}
            value={String(pinnedSignals.size)}
          />
          <StatCard
            label={t('signalDiff.windowSpan', 'Window span')}
            value={
              atAIso && atBIso
                ? `${Math.abs(new Date(atBIso).getTime() - new Date(atAIso).getTime()) / 1000} s`
                : '—'
            }
          />
        </div>
      </FadeIn>

      {/* ─── Bulk-actions toolbar ─── */}
      <BulkActionsToolbar
        selectedIds={selectedSignals}
        total={filteredRows.length}
        onClear={() => setSelectedSignals([])}
        actions={bulkActions}
      />

      {/* ─── Diff table ─── */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-4 sm:p-5">
          {error ? (
            <div className="rounded-md border border-rose-400/20 bg-rose-500/[0.05] p-3 text-sm text-rose-200">
              {t('signalDiff.error', 'Failed to load diff')}
            </div>
          ) : null}
          {isLoading && !diffResp ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} height={36} />
              ))}
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
              <span className="text-xs text-[var(--text-muted)]">
                {t('signalDiff.pinnedLabel', 'Pinned:')}
              </span>
              {Array.from(pinnedSignals)
                .sort()
                .map((s) => (
                  <Badge key={s} variant="neutral">
                    {s}
                  </Badge>
                ))}
            </div>
          ) : null}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
