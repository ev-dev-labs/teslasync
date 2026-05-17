/**
 * MaintenancePage — vehicle maintenance tracker.
 *
 * Shows maintenance items with progress/status, service history,
 * summary metrics, and scheduling. Supports multi-vehicle selection,
 * category filtering, and status sorting.
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { DataTable, type Column } from '@/components/ui/DataTable';

import { MetricCard } from '@/components/data-display/MetricCard';
import { Currency } from '@/components/data-display';
import { Skeleton } from '@/components/feedback/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { AlertBanner } from '@/components/feedback/AlertBanner';
import { FadeIn } from '@/components/motion/FadeIn';
import { VehicleSelect } from '@/components/forms';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { formatDateTime, formatDate } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { getErrorMessage } from '@/lib/errorMessage';
import { useFormatting } from '@/hooks/useFormatting';
import { request } from '@/api/client';
import { AIPredictiveMaintenance } from '@/components/ai/AIPredictiveMaintenance';
import {
  Wrench, AlertTriangle, CheckCircle, Clock, ListChecks,
  CalendarPlus, Filter, ArrowUpDown, Gauge, Tag,
  DollarSign, TrendingUp, AlertCircle,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  tires: 'cyan',
  brakes: 'red',
  battery: 'green',
  filters: 'amber',
  fluids: 'purple',
  wipers: 'cyan',
  alignment: 'amber',
  general: 'neutral',
};

const STATUS_BADGE_MAP: Record<MaintenanceStatus, { variant: 'success' | 'warning' | 'danger' | 'info'; label: string }> = {
  good: { variant: 'success', label: 'Good' },
  soon: { variant: 'warning', label: 'Due Soon' },
  overdue: { variant: 'danger', label: 'Overdue' },
  completed: { variant: 'info', label: 'Completed' },
};

const STATUS_SORT_ORDER: Record<MaintenanceStatus, number> = {
  overdue: 0,
  soon: 1,
  good: 2,
  completed: 3,
};

const SORT_OPTIONS = [
  { value: 'status', label: 'Status' },
  { value: 'name', label: 'Name' },
  { value: 'due_date', label: 'Due Date' },
  { value: 'category', label: 'Category' },
];



// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeProgress(item: MaintenanceItem): number {
  if (item.interval_miles && item.last_service_mileage != null) {
    const elapsed = item.current_mileage - item.last_service_mileage;
    return Math.min(100, Math.max(0, (elapsed / item.interval_miles) * 100));
  }
  if (item.interval_months && item.last_service_date) {
    const lastDate = new Date(item.last_service_date).getTime();
    const now = Date.now();
    const intervalMs = item.interval_months * 30.44 * 24 * 60 * 60 * 1000;
    const elapsed = now - lastDate;
    return Math.min(100, Math.max(0, (elapsed / intervalMs) * 100));
  }
  if (item.due_mileage) {
    const pct = (item.current_mileage / item.due_mileage) * 100;
    return Math.min(100, Math.max(0, pct));
  }
  return 0;
}

function statusFromPct(pct: number): MaintenanceStatus {
  if (pct >= 90) return 'overdue';
  if (pct >= 70) return 'soon';
  return 'good';
}

function progressBarColor(pct: number): string {
  if (pct >= 90) return 'bg-neon-red';
  if (pct >= 70) return 'bg-neon-amber';
  return 'bg-neon-green';
}

function categoryBgClass(category: string): string {
  const color = CATEGORY_COLORS[category] ?? 'neutral';
  const map: Record<string, string> = {
    cyan: 'bg-neon-cyan/10 text-neon-cyan',
    red: 'bg-neon-red/10 text-neon-red',
    green: 'bg-neon-green/10 text-neon-green',
    amber: 'bg-neon-amber/10 text-neon-amber',
    purple: 'bg-neon-purple/10 text-neon-purple',
    neutral: 'bg-[var(--surface-2)] text-[var(--text-secondary)]',
  };
  return map[color] ?? map.neutral;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="w-full h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
      <div
        className={cn('h-full rounded-full transition-all duration-slow', progressBarColor(pct))}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium capitalize',
        categoryBgClass(category),
      )}
    >
      <Tag className="h-3 w-3" />
      {category}
    </span>
  );
}

function MaintenanceItemCard({
  item,
  t,
}: {
  item: MaintenanceItem;
  t: (key: string) => string;
}) {
  const pct = computeProgress(item);
  const derivedStatus = item.status === 'completed' ? 'completed' : statusFromPct(pct);
  const badge = STATUS_BADGE_MAP[derivedStatus];

  return (
    <GlassPanel hover className="p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <CategoryBadge category={item.category} />
            <Badge variant={badge.variant} size="sm">{t(badge.label)}</Badge>
          </div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">
            {item.name}
          </h3>
          <p className="text-xs text-[var(--text-muted)] line-clamp-2 mt-0.5">
            {item.description}
          </p>
        </div>
      </div>

      {derivedStatus !== 'completed' && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
            <span>{fmtNumber(pct, 0)}%</span>
            <span>
              {item.due_date && (
                <>{t('Due')}: {formatDate(item.due_date)}</>
              )}
              {item.due_mileage && !item.due_date && (
                <>{t('Due')}: {fmtNumber(item.due_mileage, 0)} {t('mi')}</>
              )}
            </span>
          </div>
          <ProgressBar pct={pct} />
        </div>
      )}

      <div className="flex items-center gap-4 text-xs text-[var(--text-secondary)] mt-auto">
        {item.current_mileage > 0 && (
          <span className="flex items-center gap-1">
            <Gauge className="h-3 w-3" />
            {fmtNumber(item.current_mileage, 0)} {t('mi')}
          </span>
        )}
        {item.last_service_date && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDate(item.last_service_date)}
          </span>
        )}
      </div>
    </GlassPanel>
  );
}

// ─── Service Records columns ─────────────────────────────────────────────────

function buildServiceColumns(t: (key: string) => string): Column<ServiceRecord>[] {
  return [
    {
      key: 'date',
      header: t('Date'),
      sortable: true,
      render: (r) => (
        <span className="text-sm text-[var(--text-primary)]">{formatDateTime(r.date)}</span>
      ),
    },
    {
      key: 'description',
      header: t('Description'),
      render: (r) => (
        <span className="text-sm text-[var(--text-primary)] truncate max-w-[200px] block">
          {r.description}
        </span>
      ),
    },
    {
      key: 'mileage',
      header: t('Mileage'),
      sortable: true,
      render: (r) => (
        <span className="text-sm tabular-nums">{fmtNumber(r.mileage, 0)} {t('mi')}</span>
      ),
    },
    {
      key: 'cost',
      header: t('Cost'),
      sortable: true,
      render: (r) => (
        <Currency value={r.cost} className="text-sm tabular-nums" />
      ),
    },
    {
      key: 'provider',
      header: t('Provider'),
      render: (r) => (
        <span className="text-sm text-[var(--text-secondary)]">{r.provider || '—'}</span>
      ),
    },
  ];
}

// ─── Sorting helpers ─────────────────────────────────────────────────────────

function sortItems(items: MaintenanceItem[], sortBy: string): MaintenanceItem[] {
  const sorted = [...items];
  sorted.sort((a, b) => {
    switch (sortBy) {
      case 'status':
        return STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status];
      case 'name':
        return a.name.localeCompare(b.name);
      case 'due_date': {
        const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
        const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
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

// ─── Summary section (loading skeleton) ──────────────────────────────────────

function SummarySkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
    </div>
  );
}

function ItemsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Skeleton key={i} className="h-44 rounded-xl" />
      ))}
    </div>
  );
}

// ─── Page component ──────────────────────────────────────────────────────────

export default function MaintenancePage() {
  const { t } = useTranslation();
  usePageTitle(t('Maintenance'));
  const { formatCurrency } = useFormatting();

  // ── Vehicle selection (global) ─────────────────────────────────────────
  const { vehicleId } = useSelectedVehicle();

  // ── Data fetching ──────────────────────────────────────────────────────
  const { data: items, isLoading: loadingItems, error: itemsError } = useQuery({
    queryKey: ['maintenance', vehicleId],
    queryFn: () => request<MaintenanceItem[]>('/maintenance'),
    enabled: vehicleId !== null,
  });

  const { data: records, isLoading: loadingRecords, error: recordsError } = useQuery({
    queryKey: ['service-records', vehicleId],
    queryFn: () => request<ServiceRecord[]>('/maintenance/records'),
    enabled: vehicleId !== null,
  });

  // ── Filters & sorting ─────────────────────────────────────────────────
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('status');

  const categories = useMemo(() => {
    if (!items) return [];
    const unique = Array.from(new Set(items.map((i) => i.category))).sort();
    return unique;
  }, [items]);

  const categoryOptions = useMemo(
    () => [
      { value: 'all', label: t('All Categories') },
      ...categories.map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) })),
    ],
    [categories, t],
  );

  const sortOptions = useMemo(
    () => SORT_OPTIONS.map((o) => ({ value: o.value, label: t(o.label) })),
    [t],
  );

  // ── Filtered + sorted items ────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    if (!items) return [];
    let result = items;
    if (categoryFilter !== 'all') {
      result = result.filter((i) => i.category === categoryFilter);
    }
    return sortItems(result, sortBy);
  }, [items, categoryFilter, sortBy]);

  // ── Summary stats ──────────────────────────────────────────────────────
  const summary = useMemo(() => {
    if (!items) return { total: 0, soon: 0, overdue: 0, completed: 0 };
    return items.reduce(
      (acc, item) => {
        acc.total++;
        if (item.status === 'soon') acc.soon++;
        else if (item.status === 'overdue') acc.overdue++;
        else if (item.status === 'completed') acc.completed++;
        return acc;
      },
      { total: 0, soon: 0, overdue: 0, completed: 0 },
    );
  }, [items]);

  // ── Render ─────────────────────────────────────────────────────────────

  const serviceColumns = useMemo(() => buildServiceColumns(t), [t]);

  // ── Cost summary from service records ──────────────────────────────────
  const costStats = useMemo(() => {
    if (!records || records.length === 0) return null;
    const totalCost = records.reduce((s, r) => s + (r.cost ?? 0), 0);
    const dates = records.map((r) => new Date(r.date).getTime()).filter((d) => !isNaN(d));
    if (dates.length < 2) return { totalCost, annualCost: totalCost, avgPerService: totalCost / records.length };
    const spanYears = Math.max((Math.max(...dates) - Math.min(...dates)) / (365.25 * 24 * 3600000), 0.1);
    return {
      totalCost,
      annualCost: totalCost / spanYears,
      avgPerService: totalCost / records.length,
    };
  }, [records]);

  // ── Service projections ────────────────────────────────────────────────
  const projections = useMemo(() => {
    if (!items || items.length === 0) return [];
    return items
      .filter((i) => i.status !== 'completed' && (i.interval_miles || i.interval_months))
      .map((item) => {
        const milesRemaining =
          item.due_mileage != null ? Math.max(item.due_mileage - item.current_mileage, 0) : null;
        const dueDate = item.due_date ? formatDate(item.due_date) : null;
        return { name: item.name, category: item.category, milesRemaining, dueDate, status: item.status };
      })
      .sort((a, b) => {
        if (a.status === 'overdue' && b.status !== 'overdue') return -1;
        if (b.status === 'overdue' && a.status !== 'overdue') return 1;
        return (a.milesRemaining ?? Infinity) - (b.milesRemaining ?? Infinity);
      })
      .slice(0, 8);
  }, [items]);

  // ── Schedule handler ───────────────────────────────────────────────────
  const handleSchedule = useCallback(() => {
    // placeholder — would open scheduling modal
  }, []);

  const anyError = [itemsError, recordsError].find(Boolean);
  const isLoading = loadingItems || loadingRecords;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <PageContainer
      title={t('Maintenance')}
      subtitle={t('Service schedule, records, and upcoming maintenance')}
      loading={isLoading && !items}
      actions={<VehicleSelect />}
    >
      {anyError && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      )}

      {/* ── Summary metric cards ─────────────────────────────────── */}
      <FadeIn>
        {loadingItems && !items ? (
          <SummarySkeleton />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <MetricCard
              icon={<ListChecks className="h-5 w-5" />}
              label={t('Total Items')}
              value={summary.total}
              color="cyan"
            />
            <MetricCard
              icon={<Clock className="h-5 w-5" />}
              label={t('Due Soon')}
              value={summary.soon}
              color="amber"
            />
            <MetricCard
              icon={<AlertTriangle className="h-5 w-5" />}
              label={t('Overdue')}
              value={summary.overdue}
              color="red"
            />
            <MetricCard
              icon={<CheckCircle className="h-5 w-5" />}
              label={t('Completed')}
              value={summary.completed}
              color="green"
            />
          </div>
        )}
      </FadeIn>

      {/* ── Helix Predictive Maintenance (opt-in AI) ─────────────── */}
      {/* Phase-50 / 0049 — withAiFeature returns null when           */}
      {/* ai_mode='off' OR the predictive-maintenance toggle is off. */}
      {/* The deterministic reminders above remain the canonical    */}
      {/* baseline; this card adds an opt-in narrative section.     */}
      <FadeIn delay={0.03}>
        <AIPredictiveMaintenance vehicleId={vehicleId ?? undefined} />
      </FadeIn>

      {/* ── Filter / Sort toolbar ────────────────────────────────── */}
      <FadeIn delay={0.05}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-[var(--text-muted)]" />
            <Select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              options={categoryOptions}
            />
          </div>
          <div className="flex items-center gap-2">
            <ArrowUpDown className="h-4 w-4 text-[var(--text-muted)]" />
            <Select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              options={sortOptions}
            />
          </div>
          <div className="sm:ml-auto">
            <Button
              variant="primary"
              size="sm"
              icon={<CalendarPlus className="h-4 w-4" />}
              onClick={handleSchedule}
            >
              {t('Schedule Maintenance')}
            </Button>
          </div>
        </div>
      </FadeIn>

      {/* ── Maintenance items grid ───────────────────────────────── */}
      <FadeIn delay={0.1}>
        {loadingItems && !items ? (
          <ItemsSkeleton />
        ) : filteredItems.length === 0 ? (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Wrench className="h-12 w-12" />}
            title={t('No maintenance items')}
            message={
              categoryFilter !== 'all'
                ? t('No items match the selected category. Try a different filter.')
                : t('No maintenance items found for this vehicle.')
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredItems.map((item) => (
              <MaintenanceItemCard key={item.id} item={item} t={t} />
            ))}
          </div>
        )}
      </FadeIn>

      {/* ── Cost Summary & Service Projections ────────────────────── */}
      <FadeIn delay={0.15}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Estimated Annual Cost */}
          <GlassPanel className="p-6">
            <span className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <DollarSign className="h-4 w-4 text-green-400" />
              {t('Estimated Annual Cost')}
            </span>
            {loadingRecords && !records ? (
              <Skeleton height={80} />
            ) : costStats ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <MetricCard
                    label={t('Total Spent')}
                    value={formatCurrency(costStats.totalCost, 0)}
                    color="green"
                  />
                  <MetricCard
                    label={t('Annual Est.')}
                    value={`${formatCurrency(costStats.annualCost, 0)}/yr`}
                    color="cyan"
                  />
                  <MetricCard
                    label={t('Avg / Service')}
                    value={formatCurrency(costStats.avgPerService, 0)}
                    color="purple"
                  />
                </div>
                <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
                  <p className="text-xs text-green-400">
                    {t(
                      'EV maintenance is typically 40-60% cheaper than a comparable gas vehicle.',
                    )}
                  </p>
                </div>
              </div>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('No cost data available yet. Log service records to see cost estimates.')} />
            )}
          </GlassPanel>

          {/* Service Projections */}
          <GlassPanel className="p-6">
            <span className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <TrendingUp className="h-4 w-4 text-purple-400" />
              {t('Service Projections')}
            </span>
            {loadingItems && !items ? (
              <Skeleton height={80} />
            ) : projections.length > 0 ? (
              <div className="space-y-2.5">
                {projections.map((p) => {
                  const badge = STATUS_BADGE_MAP[p.status as MaintenanceStatus] ?? STATUS_BADGE_MAP.good;
                  return (
                    <div key={p.name} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <Wrench className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                        <span className="truncate text-[var(--text-secondary)]">{p.name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {p.milesRemaining != null && (
                          <span className="text-xs text-[var(--text-muted)]">
                            {fmtNumber(p.milesRemaining, 0)} mi
                          </span>
                        )}
                        {p.dueDate && (
                          <span className="text-xs text-[var(--text-muted)]">{p.dueDate}</span>
                        )}
                        <Badge variant={badge.variant} size="sm">
                          {t(badge.label)}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('No upcoming service projections available.')} />
            )}
          </GlassPanel>
        </div>
      </FadeIn>

      {/* ── Service records table ────────────────────────────────── */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-6">
          <span className="text-sm font-semibold mb-4 block text-[var(--text-primary)]">
            {t('Service Records')}
          </span>

          {loadingRecords && !records ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
          ) : !records?.length ? (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Wrench className="h-10 w-10" />}
              message={t('No service records logged yet.')}
            />
          ) : (
            <>
              <DataTable<ServiceRecord>
                tableId="vehicle-systems:maintenance-records"
                columns={serviceColumns}
                data={records}
                keyExtractor={(r) => r.id}
                compact
                pagination
                emptyMessage={t('No service records found.')}
              />
            </>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
