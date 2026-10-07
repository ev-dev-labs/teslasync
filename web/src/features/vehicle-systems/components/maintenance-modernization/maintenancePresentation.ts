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

/** Preserve existing categorical chart colors; surfaces and body text are
 * neutral tokens. Category identity is always visible, never color alone. */
const CATEGORY_COLORS: Record<string, string> = {
  tires: '#22d3ee',
  brakes: '#fb7185',
  battery: '#34d399',
  filters: '#fbbf24',
  fluids: '#818cf8',
  wipers: '#38bdf8',
  alignment: '#a78bfa',
  general: '#94a3b8',
};

export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? '#94a3b8';
}
