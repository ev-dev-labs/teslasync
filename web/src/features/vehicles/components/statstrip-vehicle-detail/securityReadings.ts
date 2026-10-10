import type { SecurityEvent } from '@/api/types';

export function securityDoorReading(
  value: SecurityEvent['door_state'] | undefined,
  open: string,
  closed: string,
): string | null {
  if (value == null) return null;
  if (typeof value === 'boolean') return value ? open : closed;
  const text = String(value).trim();
  return text || null;
}

/** An open window is definite; "Closed" requires every corner to be known. */
export function securityWindowReading(data: SecurityEvent | null | undefined) {
  const readings = [data?.fd_window, data?.fp_window, data?.rd_window, data?.rp_window]
    .map(value => value == null || (typeof value === 'string' && !value.trim())
      ? null : Number(value))
    .map(value => value != null && Number.isFinite(value) && value >= 0 ? value : null);
  const open = readings.filter(value => value != null && value > 0).length;
  return { open, complete: readings.every(value => value != null) };
}
