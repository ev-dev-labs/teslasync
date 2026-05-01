import {
  formatDateTime,
  formatRelativeTime,
  formatDate,
  formatDateShort,
  formatTime,
} from '@/lib/dateFormat';

export type DateTimeVariant = 'full' | 'date' | 'time' | 'relative' | 'short';

interface DateTimeProps {
  value: string | Date | null | undefined;
  variant?: DateTimeVariant;
  className?: string;
}

/**
 * Locale-aware datetime renderer that hovers the canonical ISO string for
 * unambiguous timestamps. Wraps the pure helpers in `@/lib/dateFormat`.
 */
export function DateTime({ value, variant = 'full', className }: DateTimeProps) {
  let display: string;
  switch (variant) {
    case 'relative':
      display = formatRelativeTime(value);
      break;
    case 'date':
      display = formatDate(value);
      break;
    case 'time':
      display = formatTime(value);
      break;
    case 'short':
      display = formatDateShort(value);
      break;
    case 'full':
    default:
      display = formatDateTime(value);
      break;
  }

  let title: string | undefined;
  if (value) {
    const d = value instanceof Date ? value : new Date(value);
    if (!isNaN(d.getTime())) title = d.toISOString();
  }

  return (
    <span className={className} title={title}>
      {display}
    </span>
  );
}
