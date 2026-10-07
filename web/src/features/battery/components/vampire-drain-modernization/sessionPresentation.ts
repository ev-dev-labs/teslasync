import type { TFunction } from 'i18next';
import { formatDateTime } from '@/lib/dateFormat';

interface DrainSession {
  started_at: string;
  ended_at: string;
  duration_hours: number;
  start_battery_pct: number;
  end_battery_pct: number;
  drain_pct: number;
  drain_pct_per_day: number;
  ambient_temp_c_avg: number | null;
}

/** Display accessors only: DataTable remains the sorting/paging/export owner. */
export function sessionPresentation<T extends DrainSession>(
  fmtNumber: (value: number | null | undefined) => string,
  formatTemperature: (value: number | null | undefined) => string,
  t: TFunction,
) {
  const displayValue = (row: T, key: string) => {
    switch (key) {
      case 'started_at': return formatDateTime(row.started_at);
      case 'ended_at': return formatDateTime(row.ended_at);
      case 'duration_hours': return row.duration_hours != null ? `${fmtNumber(row.duration_hours)}h` : '—';
      case 'start_battery_pct': return row.start_battery_pct != null ? `${fmtNumber(row.start_battery_pct)}%` : '—';
      case 'end_battery_pct': return row.end_battery_pct != null ? `${fmtNumber(row.end_battery_pct)}%` : '—';
      case 'drain_pct': return row.drain_pct != null ? `${fmtNumber(row.drain_pct)}%` : '—';
      case 'drain_pct_per_day': return fmtNumber(row.drain_pct_per_day);
      case 'ambient_temp_c_avg': return formatTemperature(row.ambient_temp_c_avg);
      default: return '—';
    }
  };
  return {
    roles: {
      started_at: 'title', drain_pct: 'primary', drain_pct_per_day: 'meta',
      duration_hours: 'meta', start_battery_pct: 'hidden', end_battery_pct: 'hidden',
      ambient_temp_c_avg: 'meta',
    } as const,
    displayValue,
    allDetails: (row: T) => [
      { key: 'ended_at', label: t('vampireDrain.modernization.ended', 'Ended'), value: displayValue(row, 'ended_at') },
    ],
  };
}
