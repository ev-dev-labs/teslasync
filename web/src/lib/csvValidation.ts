import type { CsvCellValue } from '@/lib/csvExport';

/**
 * Shared feature-aware CSV export contract.
 * Supports JSON/CSV scalar values and structured objects; unsupported JavaScript
 * types use an explicit placeholder instead of leaking implementation values.
 */
export function normalizeCsvCellValue(value: unknown): CsvCellValue {
  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'object'
  ) {
    return value;
  }
  return '—';
}
