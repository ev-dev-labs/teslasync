import type { SecurityEvent } from '@/api/types';

/** Unchanged coercion from the existing SecuritySection. */
export function windowOpenCount(s: SecurityEvent): number {
  const fields = [s.fd_window, s.fp_window, s.rd_window, s.rp_window];
  let open = 0;
  for (const v of fields) {
    if (v == null) continue;
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n) && n > 0) open += 1;
  }
  return open;
}

/** Unchanged boolean/string signal semantics; never stringify true as data. */
export function normalizeDoorState(
  v: SecurityEvent['door_state'],
  openLabel: string,
): string | null {
  if (v == null) return null;
  if (typeof v === 'boolean') return v ? openLabel : null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
