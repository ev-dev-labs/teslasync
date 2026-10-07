import type { MobileExportScope } from '@/components/ui/mobile-grid-reference';
import type { ReferenceRecord } from './fixtures';

/** Synthetic fixture controller logic; not a proposed production filter/export implementation. */
export function filterReferenceRows(rows: readonly ReferenceRecord[], query: string, filter: string, titles: ReadonlyMap<string, string>): ReferenceRecord[] {
  const needle = query.trim().toLocaleLowerCase();
  return rows.filter(row => (filter === 'all' || row.place === filter)
    && (!needle || `${titles.get(row.id) ?? ''} ${row.id} ${row.raw_field}`.toLocaleLowerCase().includes(needle)));
}
export function sortReferenceRows(rows: readonly ReferenceRecord[], sort: string): ReferenceRecord[] {
  return [...rows].sort((a, b) => sort === 'cost'
    ? (b.cost_usd ?? -Infinity) - (a.cost_usd ?? -Infinity)
    : sort === 'oldest' ? a.timestamp.localeCompare(b.timestamp) : b.timestamp.localeCompare(a.timestamp));
}
export function toggleReferenceKey(keys: readonly string[], key: string, mode: 'single' | 'multi' = 'multi'): string[] {
  if (keys.includes(key)) return keys.filter(item => item !== key);
  return mode === 'single' ? [key] : [...keys, key];
}
/** Request feedback only: no CSV/JSON serializer, download, API or production export adapter. */
export function referenceExportKeys(scope: MobileExportScope, loaded: readonly ReferenceRecord[], matching: readonly ReferenceRecord[], keys: readonly string[]): string[] {
  if (scope === 'selectedLoaded') return loaded.filter(row => keys.includes(row.id)).map(row => row.id);
  return (scope === 'fullResult' ? loaded : matching).map(row => row.id);
}
