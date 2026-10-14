import type { MaintenanceStatus } from './maintenanceModel';

export const SORT_OPTIONS = [
  { value: 'status', labelKey: 'maintenance.sort.status', fallback: 'Status' },
  { value: 'name', labelKey: 'maintenance.sort.name', fallback: 'Name' },
  { value: 'due_date', labelKey: 'maintenance.sort.dueDate', fallback: 'Due date' },
  { value: 'category', labelKey: 'maintenance.sort.category', fallback: 'Category' },
] as const;

export const STATUS_BADGES: Record<
  MaintenanceStatus,
  { variant: 'success' | 'warning' | 'danger' | 'info'; labelKey: string; fallback: string }
> = {
  good: { variant: 'success', labelKey: 'maintenance.status.good', fallback: 'Good' },
  soon: { variant: 'warning', labelKey: 'maintenance.status.soon', fallback: 'Due soon' },
  overdue: { variant: 'danger', labelKey: 'maintenance.status.overdue', fallback: 'Overdue' },
  completed: { variant: 'info', labelKey: 'maintenance.status.completed', fallback: 'Completed' },
};

/** Fixed slots keep category identity independent of count and display order. */
const CATEGORY_PALETTE_SLOTS = {
  tires: 0,
  brakes: 1,
  battery: 2,
  filters: 3,
  fluids: 4,
  wipers: 5,
  alignment: 6,
};

export function categoryColor(category: string, palette: readonly string[]): string {
  const slot = Object.hasOwn(CATEGORY_PALETTE_SLOTS, category)
    ? CATEGORY_PALETTE_SLOTS[category as keyof typeof CATEGORY_PALETTE_SLOTS] : undefined;
  return (slot === undefined ? undefined : palette[slot]) ?? 'var(--text-secondary)';
}
