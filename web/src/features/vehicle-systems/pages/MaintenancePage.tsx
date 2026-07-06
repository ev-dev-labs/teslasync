/**
 * MaintenancePage — vehicle maintenance tracker (modern-ui redesign).
 *
 * A full-width, mobile-first bento cockpit: a KPI band, the opt-in Helix
 * advisor, a hero items grid paired with an upcoming-service side panel, a
 * cost + category-breakdown row, and a service-records detail band.
 *
 * SI contract: odometer-derived fields (`current_mileage`, `due_mileage`,
 * `interval_miles`, record `mileage`) arrive as SI metres from the API. They
 * are converted to the user's preferred unit at the render boundary via
 * `useUnits().formatDistance`; the page never assumes miles.
 */

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, ArrowUpDown, CalendarPlus, CheckCircle, Clock,
  DollarSign, Filter, Gauge, Layers, ListChecks, RefreshCw,
  ShieldCheck, Tag, TrendingUp, Wrench,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import {
  Badge, Button, DataTable, GlassPanel, PanelTitle, Select, Subhead, Text,
  type Column,
} from '@/components/ui';
import { Currency, MetricBar, MetricCard } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { VehicleSelect } from '@/components/forms';
import { AIPredictiveMaintenance } from '@/components/ai/AIPredictiveMaintenance';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { request } from '@/api/client';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';
import { typography } from '@/lib/tokens';

// ─── Types (snake_case, matching the Go maintenance handler JSON tags) ───────

interface MaintenanceItem {
  id: number;
  vehicle_id: number;
  category: string;
  name: string;
  description: string;
  due_date: string | null;
  due_mileage: number | null;
  current_mileage: number;
  last_service_date: string | null;
  last_service_mileage: number | null;
  interval_months: number | null;
  interval_miles: number | null;
  status: 'good' | 'soon' | 'overdue' | 'completed';
  created_at: string;
}

interface ServiceRecord {
  id: number;
  vehicle_id: number;
  date: string;
  description: string;
  mileage: number;
  cost: number;
  provider: string;
  notes: string;
  created_at: string;
}

type MaintenanceStatus = 'good' | 'soon' | 'overdue' | 'completed';

/** Distance formatter surface shared by the sub-components (SI metres in). */
type DistanceFormatter = (value: number | null | undefined, options?: { precision?: number }) => string;

// ─── Constants ───────────────────────────────────────────────────────────────

/** category → semantic tone (toned 300-level shades, never neon body text). */
const CATEGORY_TONE: Record<string, string> = {
  tires: 'cyan',
  brakes: 'rose',
  battery: 'emerald',
  filters: 'amber',
  fluids: 'indigo',
  wipers: 'sky',
  alignment: 'violet',
  general: 'slate',
};

/** tone → chip classes (static literals so Tailwind can tree-shake them). */
const TONE_CHIP: Record<string, string> = {
  cyan: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
  rose: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
  emerald: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  amber: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  indigo: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20',
  sky: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
  violet: 'bg-violet-500/10 text-violet-300 border-violet-500/20',
  slate: 'bg-slate-500/10 text-slate-300 border-slate-500/20',
};

/** tone → hex for MetricBar fills + projection dots (dynamic, chart-token style). */
const TONE_HEX: Record<string, string> = {
  cyan: '#22d3ee',
  rose: '#fb7185',
  emerald: '#34d399',
  amber: '#fbbf24',
  indigo: '#818cf8',
  sky: '#38bdf8',
  violet: '#a78bfa',
  slate: '#94a3b8',
};

const STATUS_BADGE_MAP: Record<
  MaintenanceStatus,
  { variant: 'success' | 'warning' | 'danger' | 'info'; labelKey: string; fallback: string }
> = {
  good: { variant: 'success', labelKey: 'maintenance.status.good', fallback: 'Good' },
  soon: { variant: 'warning', labelKey: 'maintenance.status.soon', fallback: 'Due Soon' },
  overdue: { variant: 'danger', labelKey: 'maintenance.status.overdue', fallback: 'Overdue' },
  completed: { variant: 'info', labelKey: 'maintenance.status.completed', fallback: 'Completed' },
};

const STATUS_SORT_ORDER: Record<MaintenanceStatus, number> = {
  overdue: 0,
  soon: 1,
  good: 2,
  completed: 3,
};

const SORT_OPTIONS: Array<{ value: string; labelKey: string; fallback: string }> = [
  { value: 'status', labelKey: 'maintenance.sort.status', fallback: 'Status' },
  { value: 'name', labelKey: 'maintenance.sort.name', fallback: 'Name' },
  { value: 'due_date', labelKey: 'maintenance.sort.dueDate', fallback: 'Due Date' },
  { value: 'category', labelKey: 'maintenance.sort.category', fallback: 'Category' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toneFor(category: string): string {
  return CATEGORY_TONE[category] ?? 'slate';
}

/** Clamp any (possibly non-finite) ratio into the renderable 0–100 band. */
function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Progress % is a ratio, so it is unit-agnostic (SI metres or months alike). */
function computeProgress(item: MaintenanceItem): number {
  if (item.interval_miles && item.last_service_mileage != null) {
    const elapsed = item.current_mileage - item.last_service_mileage;
    return clampPct((elapsed / item.interval_miles) * 100);
  }
  if (item.interval_months && item.last_service_date) {
    const lastDate = new Date(item.last_service_date).getTime();
    // A malformed `last_service_date` yields NaN here; guard so the bar
    // renders 0% rather than a `width: NaN%` (dropped by the browser) and a
    // NaN `aria-valuenow`.
    if (!Number.isFinite(lastDate)) return 0;
    const intervalMs = item.interval_months * 30.44 * 24 * 60 * 60 * 1000;
    const elapsed = Date.now() - lastDate;
    return clampPct((elapsed / intervalMs) * 100);
  }
  if (item.due_mileage) {
    return clampPct((item.current_mileage / item.due_mileage) * 100);
  }
  return 0;
}

function statusFromPct(pct: number): MaintenanceStatus {
  if (pct >= 90) return 'overdue';
  if (pct >= 70) return 'soon';
  return 'good';
}

function progressFillClass(pct: number): string {
  if (pct >= 90) return 'bg-rose-500';
  if (pct >= 70) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function sortItems(items: MaintenanceItem[], sortBy: string): MaintenanceItem[] {
  const sorted = [...items];
  sorted.sort((a, b) => {
    switch (sortBy) {
      case 'status':
        return STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status];
      case 'name':
        return a.name.localeCompare(b.name);
      case 'due_date': {
        // Null-due items sort last; a malformed date string also collapses to
        // Infinity (rather than producing a NaN comparator, which V8 treats as
        // 0 and leaves the order non-deterministic). Ties break by name so the
        // sort is stable and reproducible.
        const rawA = a.due_date ? new Date(a.due_date).getTime() : Infinity;
        const rawB = b.due_date ? new Date(b.due_date).getTime() : Infinity;
        const da = Number.isFinite(rawA) ? rawA : Infinity;
        const db = Number.isFinite(rawB) ? rawB : Infinity;
        if (da === db) return a.name.localeCompare(b.name);
        return da - db;
      }
      case 'category':
        return a.category.localeCompare(b.category);
      default:
        return 0;
    }
  });
  return sorted;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ProgressBar({ pct, label }: { pct: number; label?: string }) {
  const clamped = clampPct(pct);
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
    >
      <div
        className={cn('h-full rounded-full transition-all duration-slow', progressFillClass(clamped))}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function CategoryChip({ category }: { category: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 capitalize',
        typography.size.xs,
        typography.weight.medium,
        TONE_CHIP[toneFor(category)],
      )}
    >
      <Tag className="h-3 w-3" aria-hidden="true" />
      {category}
    </span>
  );
}

function StatusBadgeFor({ status }: { status: MaintenanceStatus }) {
  const { t } = useTranslation();
  const badge = STATUS_BADGE_MAP[status];
  return (
    <Badge variant={badge.variant} size="sm">
      {t(badge.labelKey, badge.fallback)}
    </Badge>
  );
}

function MaintenanceItemCard({
  item,
  formatDistance,
}: {
  item: MaintenanceItem;
  formatDistance: DistanceFormatter;
}) {
  const { t } = useTranslation();
  const pct = computeProgress(item);
  const derivedStatus = item.status === 'completed' ? 'completed' : statusFromPct(pct);

  return (
    <GlassPanel hover className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <CategoryChip category={item.category} />
            <StatusBadgeFor status={derivedStatus} />
          </div>
          <Subhead className="truncate text-[var(--text-primary)]">{item.name}</Subhead>
          <Text variant="caption" as="p" className="mt-0.5 line-clamp-2">
            {item.description}
          </Text>
        </div>
      </div>

      {derivedStatus !== 'completed' && (
        <div className="space-y-1">
          <div className={cn('flex items-center justify-between', typography.size['2xs'], typography.color.muted)}>
            <span className="tabular-nums">{fmtInt(pct)}%</span>
            <span>
              {item.due_date
                ? `${t('maintenance.due', 'Due')}: ${formatDate(item.due_date)}`
                : item.due_mileage
                  ? `${t('maintenance.due', 'Due')}: ${formatDistance(item.due_mileage, { precision: 0 })}`
                  : null}
            </span>
          </div>
          <ProgressBar
            pct={pct}
            label={t('maintenance.itemProgress', '{{name}} service progress', { name: item.name })}
          />
        </div>
      )}

      <div className={cn('mt-auto flex flex-wrap items-center gap-4', typography.size.xs, typography.color.secondary)}>
        {item.current_mileage > 0 && (
          <span className="flex items-center gap-1">
            <Gauge className="h-3 w-3" aria-hidden="true" />
            {formatDistance(item.current_mileage, { precision: 0 })}
          </span>
        )}
        {item.last_service_date && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {formatDate(item.last_service_date)}
          </span>
        )}
      </div>
    </GlassPanel>
  );
}

function SummarySkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
    </div>
  );
}

function ItemsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-44 rounded-xl" />
      ))}
    </div>
  );
}

// ─── Service-records table columns ───────────────────────────────────────────

function buildServiceColumns(
  t: (key: string, fallback: string) => string,
  formatDistance: DistanceFormatter,
): Column<ServiceRecord>[] {
  return [
    {
      key: 'date',
      header: t('maintenance.col.date', 'Date'),
      sortable: true,
      render: (r) => <Text variant="body">{formatDateTime(r.date)}</Text>,
    },
    {
      key: 'description',
      header: t('maintenance.col.description', 'Description'),
      render: (r) => (
        <Text as="span" variant="body" className="block max-w-[220px] truncate">
          {r.description || '—'}
        </Text>
      ),
    },
    {
      key: 'mileage',
      header: t('maintenance.col.mileage', 'Mileage'),
      sortable: true,
      render: (r) => <Text as="span" size="sm" className="tabular-nums">{formatDistance(r.mileage, { precision: 0 })}</Text>,
    },
    {
      key: 'cost',
      header: t('maintenance.col.cost', 'Cost'),
      sortable: true,
      render: (r) => <Currency value={r.cost} className={cn(typography.size.sm, 'tabular-nums')} />,
    },
    {
      key: 'provider',
      header: t('maintenance.col.provider', 'Provider'),
      render: (r) => <Text as="span" size="sm" color="secondary">{r.provider || '—'}</Text>,
    },
  ];
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function MaintenancePage() {
  const { t } = useTranslation();
  usePageTitle(t('maintenance.title', 'Maintenance'));
  const { formatDistance } = useUnits();
  const { formatCurrency } = useFormatting();

  const { vehicleId } = useSelectedVehicle();
  const enabled = vehicleId !== null;

  const itemsQuery = useQuery({
    queryKey: ['maintenance', vehicleId],
    queryFn: () => request<MaintenanceItem[]>('/maintenance'),
    enabled,
  });
  const recordsQuery = useQuery({
    queryKey: ['maintenance-records', vehicleId],
    queryFn: () => request<ServiceRecord[]>('/maintenance/records'),
    enabled,
  });

  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const records = useMemo(() => recordsQuery.data ?? [], [recordsQuery.data]);

  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('status');

  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category))).sort(),
    [items],
  );

  const categoryOptions = useMemo(
    () => [
      { value: 'all', label: t('maintenance.allCategories', 'All Categories') },
      ...categories.map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) })),
    ],
    [categories, t],
  );

  const sortOptions = useMemo(
    () => SORT_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey, o.fallback) })),
    [t],
  );

  const filteredItems = useMemo(() => {
    const scoped = categoryFilter === 'all' ? items : items.filter((i) => i.category === categoryFilter);
    return sortItems(scoped, sortBy);
  }, [items, categoryFilter, sortBy]);

  const summary = useMemo(
    () =>
      items.reduce(
        (acc, item) => {
          acc.total += 1;
          if (item.status === 'soon') acc.soon += 1;
          else if (item.status === 'overdue') acc.overdue += 1;
          else if (item.status === 'completed') acc.completed += 1;
          else acc.good += 1;
          return acc;
        },
        { total: 0, good: 0, soon: 0, overdue: 0, completed: 0 },
      ),
    [items],
  );

  const costStats = useMemo(() => {
    if (records.length === 0) return null;
    const totalCost = records.reduce((s, r) => s + (r.cost ?? 0), 0);
    const dates = records.map((r) => new Date(r.date).getTime()).filter((d) => !Number.isNaN(d));
    if (dates.length < 2) {
      return { totalCost, annualCost: totalCost, avgPerService: totalCost / records.length };
    }
    const spanYears = Math.max((Math.max(...dates) - Math.min(...dates)) / (365.25 * 24 * 3600000), 0.1);
    return { totalCost, annualCost: totalCost / spanYears, avgPerService: totalCost / records.length };
  }, [records]);

  const categoryBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    const max = Math.max(1, ...counts.values());
    return Array.from(counts.entries())
      .map(([category, count]) => ({ category, count, max, hex: TONE_HEX[toneFor(category)] }))
      .sort((a, b) => b.count - a.count);
  }, [items]);

  const projections = useMemo(
    () =>
      items
        .filter((i) => i.status !== 'completed' && (i.interval_miles || i.interval_months))
        .map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          metersRemaining:
            item.due_mileage != null ? Math.max(item.due_mileage - item.current_mileage, 0) : null,
          dueDate: item.due_date ? formatDate(item.due_date) : null,
          status: item.status,
        }))
        .sort((a, b) => {
          if (a.status === 'overdue' && b.status !== 'overdue') return -1;
          if (b.status === 'overdue' && a.status !== 'overdue') return 1;
          return (a.metersRemaining ?? Infinity) - (b.metersRemaining ?? Infinity);
        })
        .slice(0, 8),
    [items],
  );

  const serviceColumns = useMemo(() => buildServiceColumns(t, formatDistance), [t, formatDistance]);

  const handleSchedule = useCallback(() => {
    // Placeholder — a future slice opens the scheduling modal here. The
    // deterministic reminders above remain the canonical baseline.
  }, []);

  const handleRefresh = useCallback(() => {
    itemsQuery.refetch();
    recordsQuery.refetch();
  }, [itemsQuery, recordsQuery]);

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <VehicleSelect />
      <Button
        variant="primary"
        size="sm"
        icon={<CalendarPlus className="h-4 w-4" />}
        onClick={handleSchedule}
      >
        {t('maintenance.schedule', 'Schedule')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleRefresh}
        aria-label={t('maintenance.refresh', 'Refresh maintenance data')}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  return (
    <PageContainer
      title={t('maintenance.title', 'Maintenance')}
      subtitle={t('maintenance.subtitle', 'Service schedule, records, and upcoming maintenance')}
      actions={actions}
      query={[itemsQuery, recordsQuery]}
    >
      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section aria-label={t('maintenance.kpis', 'Maintenance summary')}>
          {itemsQuery.isLoading ? (
            <SummarySkeleton />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
              <MetricCard
                icon={<ListChecks className="h-5 w-5" />}
                label={t('maintenance.kpi.total', 'Total Items')}
                value={summary.total}
                color="cyan"
              />
              <MetricCard
                icon={<AlertTriangle className="h-5 w-5" />}
                label={t('maintenance.kpi.overdue', 'Overdue')}
                value={summary.overdue}
                color="red"
              />
              <MetricCard
                icon={<Clock className="h-5 w-5" />}
                label={t('maintenance.kpi.soon', 'Due Soon')}
                value={summary.soon}
                color="amber"
              />
              <MetricCard
                icon={<ShieldCheck className="h-5 w-5" />}
                label={t('maintenance.kpi.healthy', 'Healthy')}
                value={summary.good}
                color="green"
              />
              <MetricCard
                icon={<CheckCircle className="h-5 w-5" />}
                label={t('maintenance.kpi.completed', 'Completed')}
                value={summary.completed}
                color="blue"
              />
              <MetricCard
                icon={<Layers className="h-5 w-5" />}
                label={t('maintenance.kpi.categories', 'Categories')}
                value={categories.length}
                color="purple"
              />
            </div>
          )}
        </section>
      </FadeIn>

      {/* 2 — Helix predictive maintenance (opt-in AI; self-gating → null when off) */}
      <FadeIn delay={0.05}>
        <AIPredictiveMaintenance vehicleId={vehicleId ?? undefined} />
      </FadeIn>

      {/* 3 — Primary bento: hero items grid + upcoming projections side panel */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <PanelTitle className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('maintenance.itemsTitle', 'Maintenance Items')}
              </PanelTitle>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <Filter className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
                  <Select
                    size="sm"
                    aria-label={t('maintenance.filterCategory', 'Filter by category')}
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    options={categoryOptions}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <ArrowUpDown className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
                  <Select
                    size="sm"
                    aria-label={t('maintenance.sortBy', 'Sort items')}
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    options={sortOptions}
                  />
                </div>
              </div>
            </div>

            {itemsQuery.isLoading ? (
              <ItemsSkeleton />
            ) : itemsQuery.isError ? (
              <QueryError error={itemsQuery.error} onRetry={() => itemsQuery.refetch()} />
            ) : filteredItems.length === 0 ? (
              <EmptyState
                icon={<Wrench className="h-12 w-12" />}
                title={t('maintenance.noItemsTitle', 'No maintenance items')}
                message={
                  categoryFilter !== 'all'
                    ? t('maintenance.noItemsFiltered', 'No items match the selected category. Try a different filter.')
                    : t('maintenance.noItems', 'No maintenance items found for this vehicle.')
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                {filteredItems.map((item) => (
                  <MaintenanceItemCard key={item.id} item={item} formatDistance={formatDistance} />
                ))}
              </div>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('maintenance.projectionsTitle', 'Service Projections')}
            </PanelTitle>
            {itemsQuery.isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-8 rounded-lg" />
                ))}
              </div>
            ) : itemsQuery.isError ? (
              <QueryError error={itemsQuery.error} onRetry={() => itemsQuery.refetch()} />
            ) : projections.length === 0 ? (
              <EmptyState message={t('maintenance.noProjections', 'No upcoming service projections available.')} />
            ) : (
              <ul className="space-y-2.5">
                {projections.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: TONE_HEX[toneFor(p.category)] }}
                        aria-hidden="true"
                      />
                      <Text variant="bodySm" as="span" className="truncate">{p.name}</Text>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {p.metersRemaining != null && (
                        <Text variant="caption" as="span" className="tabular-nums">
                          {formatDistance(p.metersRemaining, { precision: 0 })}
                        </Text>
                      )}
                      {p.dueDate && (
                        <Text variant="caption" as="span">{p.dueDate}</Text>
                      )}
                      <StatusBadgeFor status={p.status as MaintenanceStatus} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 4 — Secondary bento: cost summary + category breakdown */}
      <FadeIn delay={0.15}>
        <section className="grid grid-cols-1 gap-4 2xl:grid-cols-2 xl:gap-5">
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              {t('maintenance.costTitle', 'Estimated Annual Cost')}
            </PanelTitle>
            {recordsQuery.isLoading ? (
              <Skeleton height={120} />
            ) : recordsQuery.isError ? (
              <QueryError error={recordsQuery.error} onRetry={() => recordsQuery.refetch()} />
            ) : costStats ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <MetricCard
                    label={t('maintenance.totalSpent', 'Total Spent')}
                    value={formatCurrency(costStats.totalCost, 0)}
                    color="green"
                  />
                  <MetricCard
                    label={t('maintenance.annualEst', 'Annual Est.')}
                    value={`${formatCurrency(costStats.annualCost, 0)}${t('maintenance.perYear', '/yr')}`}
                    color="cyan"
                  />
                  <MetricCard
                    label={t('maintenance.avgService', 'Avg / Service')}
                    value={formatCurrency(costStats.avgPerService, 0)}
                    color="purple"
                  />
                </div>
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <Text variant="bodySm" as="p" className="text-emerald-300">
                    {t('maintenance.evNote', 'EV maintenance is typically 40-60% cheaper than a comparable gas vehicle.')}
                  </Text>
                </div>
              </div>
            ) : (
              <EmptyState message={t('maintenance.noCost', 'No cost data available yet. Log service records to see cost estimates.')} />
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <Layers className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('maintenance.categoryTitle', 'Maintenance by Category')}
            </PanelTitle>
            {itemsQuery.isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-8 rounded-lg" />
                ))}
              </div>
            ) : itemsQuery.isError ? (
              <QueryError error={itemsQuery.error} onRetry={() => itemsQuery.refetch()} />
            ) : categoryBreakdown.length === 0 ? (
              <EmptyState message={t('maintenance.noCategory', 'No maintenance items to categorize yet.')} />
            ) : (
              <div className="space-y-3">
                {categoryBreakdown.map((row) => (
                  <MetricBar
                    key={row.category}
                    label={row.category.charAt(0).toUpperCase() + row.category.slice(1)}
                    value={row.count}
                    max={row.max}
                    color={row.hex}
                    sublabel={`${fmtInt(row.count)} ${t('maintenance.items', 'items')}`}
                  />
                ))}
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 5 — Detail band: full-width service-records table */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Wrench className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('maintenance.recordsTitle', 'Service Records')}
          </PanelTitle>
          {recordsQuery.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
          ) : recordsQuery.isError ? (
            <QueryError error={recordsQuery.error} onRetry={() => recordsQuery.refetch()} />
          ) : records.length === 0 ? (
            <EmptyState
              icon={<Wrench className="h-10 w-10" />}
              message={t('maintenance.noRecords', 'No service records logged yet.')}
            />
          ) : (
            <DataTable<ServiceRecord>
              tableId="vehicle-systems:maintenance-records"
              columns={serviceColumns}
              data={records}
              keyExtractor={(r) => r.id}
              compact
              pagination
              emptyMessage={t('maintenance.noRecordsShort', 'No service records found.')}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
