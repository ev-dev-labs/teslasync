import type { SchemaDrift } from '@/types/admin-operator-confidence';
import { fmtInt } from '@/lib/numberFormat';

export interface SchemaSectionState {
  drift: SchemaDrift | null;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

export function formatSchemaDelta(delta: number | null | undefined): string {
  if (delta == null || !Number.isFinite(delta)) return '—';
  if (delta === 0) return '0';
  return delta > 0 ? `+${fmtInt(delta)}` : fmtInt(delta);
}

export function schemaDeltaTone(delta: number): 'success' | 'warn' {
  return delta === 0 ? 'success' : 'warn';
}
