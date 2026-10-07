import type { MaintenanceItem, ServiceRecord } from '@/api/hooks/useMaintenance';

/** Consume the API integrator's complete raw contracts. No second DTO or
 * legacy-unit adapter; these functions never mutate cached data. */
export type { MaintenanceItem, ServiceRecord } from '@/api/hooks/useMaintenance';

export type MaintenanceStatus = MaintenanceItem['status'];
export type DistanceFormatter = (
  value: number | null | undefined,
  options?: { precision?: number },
) => string;

export interface MaintenanceSummary {
  total: number;
  good: number;
  soon: number;
  overdue: number;
  completed: number;
}

export interface CostStatistics {
  totalCost: number;
  annualCost: number;
  avgPerService: number;
}

export interface ServiceProjection {
  id: number;
  name: string;
  category: string;
  metersRemaining: number | null;
  dueDate: string | null;
  status: MaintenanceStatus;
}

export interface CategoryBreakdown {
  category: string;
  count: number;
  max: number;
}

const STATUS_ORDER: Record<MaintenanceStatus, number> = {
  overdue: 0,
  soon: 1,
  good: 2,
  completed: 3,
};

/** Preserve the established numerical clamp, including invalid-date fallback.
 * This is not evidence that a missing service basis is a measured zero. */
export function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Preserve precedence and the specialist 30.44-day month denominator.
 * `now` only makes the existing Date.now calculation reproducible in tests. */
export function computeProgress(item: MaintenanceItem, now = Date.now()): number {
  if (item.interval_miles && item.last_service_mileage != null) {
    return clampPct(
      ((item.current_mileage - item.last_service_mileage) / item.interval_miles) * 100,
    );
  }
  if (item.interval_months && item.last_service_date) {
    const lastDate = new Date(item.last_service_date).getTime();
    if (!Number.isFinite(lastDate)) return 0;
    const intervalMs = item.interval_months * 30.44 * 24 * 60 * 60 * 1000;
    return clampPct(((now - lastDate) / intervalMs) * 100);
  }
  if (item.due_mileage) {
    return clampPct((item.current_mileage / item.due_mileage) * 100);
  }
  return 0;
}

export function statusFromPct(pct: number): MaintenanceStatus {
  if (pct >= 90) return 'overdue';
  if (pct >= 70) return 'soon';
  return 'good';
}

export function progressFillClass(pct: number): string {
  if (pct >= 90) return 'bg-rose-500';
  if (pct >= 70) return 'bg-amber-500';
  return 'bg-emerald-500';
}

/** Sorting never changes cache ordering or the caller's array. */
export function sortItems(items: readonly MaintenanceItem[], sortBy: string): MaintenanceItem[] {
  return [...items].sort((a, b) => {
    switch (sortBy) {
      case 'status':
        return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      case 'name':
        return a.name.localeCompare(b.name);
      case 'category':
        return a.category.localeCompare(b.category);
      case 'due_date': {
        const rawA = a.due_date ? new Date(a.due_date).getTime() : Infinity;
        const rawB = b.due_date ? new Date(b.due_date).getTime() : Infinity;
        const da = Number.isFinite(rawA) ? rawA : Infinity;
        const db = Number.isFinite(rawB) ? rawB : Infinity;
        return da === db ? a.name.localeCompare(b.name) : da - db;
      }
      default:
        return 0;
    }
  });
}

/** All returned items, not the filtered cards or the projection subset. */
export function summarizeItems(items: readonly MaintenanceItem[]): MaintenanceSummary {
  return items.reduce<MaintenanceSummary>((summary, item) => {
    summary.total += 1;
    if (item.status === 'soon') summary.soon += 1;
    else if (item.status === 'overdue') summary.overdue += 1;
    else if (item.status === 'completed') summary.completed += 1;
    else summary.good += 1;
    return summary;
  }, { total: 0, good: 0, soon: 0, overdue: 0, completed: 0 });
}

/** Keep the original all-record denominator and minimum 0.1-year span.
 * A single valid date uses total cost as the annual estimate; this is an
 * inherited estimate, not a new claim of annual coverage or completeness. */
export function calculateCostStatistics(records: readonly ServiceRecord[]): CostStatistics | null {
  if (records.length === 0) return null;
  const totalCost = records.reduce((sum, record) => sum + (record.cost ?? 0), 0);
  const dates = records.map(record => new Date(record.date).getTime())
    .filter(date => !Number.isNaN(date));
  if (dates.length < 2) {
    return { totalCost, annualCost: totalCost, avgPerService: totalCost / records.length };
  }
  const spanYears = Math.max(
    (Math.max(...dates) - Math.min(...dates)) / (365.25 * 24 * 3600000),
    0.1,
  );
  return { totalCost, annualCost: totalCost / spanYears, avgPerService: totalCost / records.length };
}

/** Bar denominator is the largest category count, not total item count. */
export function countCategories(items: readonly MaintenanceItem[]): CategoryBreakdown[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  const max = Math.max(1, ...counts.values());
  return Array.from(counts, ([category, count]) => ({ category, count, max }))
    .sort((a, b) => b.count - a.count);
}

/** Eligibility and the eight-row horizon deliberately remain unchanged. */
export function projectServices(
  items: readonly MaintenanceItem[],
  displayDate: (date: string) => string,
): ServiceProjection[] {
  return items
    .filter(item => item.status !== 'completed' && (item.interval_miles || item.interval_months))
    .map(item => ({
      id: item.id,
      name: item.name,
      category: item.category,
      metersRemaining: item.due_mileage != null
        ? Math.max(item.due_mileage - item.current_mileage, 0) : null,
      dueDate: item.due_date ? displayDate(item.due_date) : null,
      status: item.status,
    }))
    .sort((a, b) => {
      if (a.status === 'overdue' && b.status !== 'overdue') return -1;
      if (b.status === 'overdue' && a.status !== 'overdue') return 1;
      return (a.metersRemaining ?? Infinity) - (b.metersRemaining ?? Infinity);
    })
    .slice(0, 8);
}
